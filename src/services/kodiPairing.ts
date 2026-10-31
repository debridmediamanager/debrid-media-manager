import { randomBytes, randomInt } from 'crypto';
import Redis from 'ioredis';

/**
 * Linking a Kodi to a DMM account without typing a key on a TV remote.
 *
 * Kodi asks for a pairing and shows the short user code (and a QR of the link
 * that carries it). The member opens that link on a signed-in phone or computer,
 * which approves the code with the DMM Cast addons and sponsor key that browser
 * holds. Kodi polls with the long device code, which only it has seen, and gets
 * them once. Both codes die after PAIRING_TTL_SECONDS or on the first collect.
 *
 * Redis-backed so any Swarm replica can answer the poll; in memory when there is
 * no Redis, which is only right for a single dev instance.
 */

export const PAIRING_TTL_SECONDS = 600;
export const POLL_INTERVAL_SECONDS = 3;

// No 0/O, 1/I/L: the code is read off a TV across a room.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export interface KodiAccount {
	service: string;
	name: string;
	/** The DMM Cast addon base, `<origin>/api/stremio[-xx]/<userid>`. */
	addon: string;
}

export interface KodiLink {
	accounts: KodiAccount[];
	sponsor: { apiKey: string; githubUsername: string } | null;
}

interface Pairing {
	userCode: string;
	ip?: string;
	link?: KodiLink;
}

const codeKey = (userCode: string) => `kodi:pair:code:${userCode}`;
const deviceKey = (deviceCode: string) => `kodi:pair:device:${deviceCode}`;

/** Upper-cases and drops the dash and spaces people type; null when it cannot be a code. */
export function normalizeUserCode(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const code = raw.toUpperCase().replace(/[\s-]/g, '');
	return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c))
		? code
		: null;
}

export function formatUserCode(code: string): string {
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// Every write is conditional, so a pairing can neither come back from expiry without a TTL
// nor be approved or collected twice when two requests race on different replicas.
interface Store {
	get(key: string): Promise<string | null>;
	/** SET NX EX: false when the key already exists. */
	create(key: string, value: string): Promise<boolean>;
	/** SET XX KEEPTTL: false when the key has already expired. */
	replace(key: string, value: string): Promise<boolean>;
	/** How many of the keys existed. */
	del(...keys: string[]): Promise<number>;
}

const memory = new Map<string, { value: string; expiresAt: number }>();

const memoryGet = (key: string) => {
	const entry = memory.get(key);
	if (entry && entry.expiresAt > Date.now()) return entry;
	memory.delete(key);
	return null;
};

const memoryStore: Store = {
	async get(key) {
		return memoryGet(key)?.value ?? null;
	},
	async create(key, value) {
		if (memoryGet(key)) return false;
		memory.set(key, { value, expiresAt: Date.now() + PAIRING_TTL_SECONDS * 1000 });
		return true;
	},
	async replace(key, value) {
		const entry = memoryGet(key);
		if (!entry) return false;
		memory.set(key, { value, expiresAt: entry.expiresAt });
		return true;
	},
	async del(...keys) {
		return keys.filter((key) => memoryGet(key) && memory.delete(key)).length;
	},
};

let redis: Redis | null = null;

function store(): Store {
	if (!process.env.REDIS_URL) return memoryStore;
	redis ??= new Redis(process.env.REDIS_URL, {
		maxRetriesPerRequest: 1,
		connectTimeout: 2000,
		commandTimeout: 1000,
		lazyConnect: true,
	});
	const client = redis;
	return {
		get: (key) => client.get(key),
		create: async (key, value) =>
			(await client.set(key, value, 'EX', PAIRING_TTL_SECONDS, 'NX')) === 'OK',
		replace: async (key, value) => (await client.set(key, value, 'KEEPTTL', 'XX')) === 'OK',
		del: (...keys) => client.del(...keys),
	};
}

/** `ip` is where Kodi asked from, so approval can tell when the browser is somewhere else. */
export async function createPairing(ip: string): Promise<{ userCode: string; deviceCode: string }> {
	const s = store();
	for (;;) {
		const userCode = Array.from(
			{ length: CODE_LENGTH },
			() => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
		).join('');
		const deviceCode = randomBytes(32).toString('base64url');
		if (!(await s.create(codeKey(userCode), deviceCode))) continue; // a live code was drawn again
		await s.create(deviceKey(deviceCode), JSON.stringify({ userCode, ip } satisfies Pairing));
		return { userCode, deviceCode };
	}
}

export type ApproveResult = 'ok' | 'unknown' | 'used' | 'other-network';

/**
 * 'unknown' covers expired and mistyped codes alike; 'used' a code already approved.
 *
 * 'other-network' when the browser is not on the address Kodi paired from and the member has
 * not confirmed: a pairing link sent by someone else would otherwise hand that someone the
 * member's addons with one click, which is the device-code phishing every such flow invites.
 * A phone on mobile data is the honest case, so it asks rather than refuses.
 */
export async function approvePairing(
	userCode: string,
	link: KodiLink,
	ip: string,
	confirmedOtherNetwork = false
): Promise<ApproveResult> {
	const s = store();
	const deviceCode = await s.get(codeKey(userCode));
	const raw = deviceCode ? await s.get(deviceKey(deviceCode)) : null;
	if (!deviceCode || !raw) return 'unknown';
	const pairing = JSON.parse(raw) as Pairing;
	if (pairing.link) return 'used';
	if (pairing.ip && pairing.ip !== ip && !confirmedOtherNetwork) return 'other-network';
	if (!(await s.create(`kodi:pair:approved:${userCode}`, '1'))) return 'used';
	return (await s.replace(deviceKey(deviceCode), JSON.stringify({ ...pairing, link })))
		? 'ok'
		: 'unknown';
}

/** The link once, on the first poll after approval; 'pending' before; 'expired' after. */
export async function collectPairing(
	deviceCode: string
): Promise<KodiLink | 'pending' | 'expired'> {
	const s = store();
	const raw = await s.get(deviceKey(deviceCode));
	if (!raw) return 'expired';
	const pairing = JSON.parse(raw) as Pairing;
	if (!pairing.link) return 'pending';
	// Only the poll whose delete removed the key gets the link.
	if (!(await s.del(deviceKey(deviceCode)))) return 'expired';
	await s.del(codeKey(pairing.userCode));
	return pairing.link;
}
