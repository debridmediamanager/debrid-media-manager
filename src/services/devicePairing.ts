import { randomBytes, randomInt } from 'crypto';
import Redis from 'ioredis';

/**
 * Linking a device to a DMM browser without typing a key on a TV remote: the Kodi
 * addon (kodiPairing) and DMM Mobile on a TV (/api/tv/*).
 *
 * The device asks for a pairing and shows the short user code (and a QR of the link
 * that carries it). The member opens that link on a signed-in phone or computer,
 * which approves the code with what that browser holds. The device polls with the
 * long device code, which only it has seen, and gets it once. Both codes die after
 * PAIRING_TTL_SECONDS or on the first collect.
 *
 * Redis-backed so any Swarm replica can answer the poll; in memory when there is
 * no Redis, which is only right for a single dev instance.
 */

export const PAIRING_TTL_SECONDS = 600;
export const POLL_INTERVAL_SECONDS = 3;

// No 0/O, 1/I/L: the code is read off a TV across a room.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Each kind has codes of its own; `kodi` keeps the key names its live pairings were stored under. */
export type PairingKind = 'kodi' | 'tv';

interface Pairing<L> {
	userCode: string;
	ip?: string;
	/** The address the device reached DMM at, so Kodi's addons are on a server it can reach. */
	origin?: string;
	link?: L;
}

const codeKey = (kind: PairingKind, userCode: string) => `${kind}:pair:code:${userCode}`;
const deviceKey = (kind: PairingKind, deviceCode: string) => `${kind}:pair:device:${deviceCode}`;

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

/**
 * `ip` is where the device asked from, so approval can tell when the browser is somewhere
 * else; `origin` the address it asked at.
 */
export async function createPairing(
	kind: PairingKind,
	ip: string,
	origin: string
): Promise<{ userCode: string; deviceCode: string }> {
	const s = store();
	for (;;) {
		const userCode = Array.from(
			{ length: CODE_LENGTH },
			() => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
		).join('');
		const deviceCode = randomBytes(32).toString('base64url');
		if (!(await s.create(codeKey(kind, userCode), deviceCode))) continue; // a live code was drawn again
		await s.create(
			deviceKey(kind, deviceCode),
			JSON.stringify({ userCode, ip, origin } satisfies Pairing<never>)
		);
		return { userCode, deviceCode };
	}
}

export type ApproveResult = 'ok' | 'unknown' | 'used' | 'other-network';

/**
 * 'unknown' covers expired and mistyped codes alike; 'used' a code already approved.
 *
 * 'other-network' when the browser is not on the address the device paired from and the
 * member has not confirmed: a pairing link sent by someone else would otherwise hand that
 * someone what the member's browser holds with one click, which is the device-code phishing
 * every such flow invites. A phone on mobile data is the honest case, so it asks rather than
 * refuses.
 *
 * `link` builds what the device collects from the address it paired at.
 */
export async function approvePairing<L>(
	kind: PairingKind,
	userCode: string,
	link: (origin: string) => L,
	ip: string,
	confirmedOtherNetwork = false
): Promise<ApproveResult> {
	const s = store();
	const deviceCode = await s.get(codeKey(kind, userCode));
	const raw = deviceCode ? await s.get(deviceKey(kind, deviceCode)) : null;
	if (!deviceCode || !raw) return 'unknown';
	const pairing = JSON.parse(raw) as Pairing<L>;
	if (pairing.link) return 'used';
	if (pairing.ip && pairing.ip !== ip && !confirmedOtherNetwork) return 'other-network';
	if (!(await s.create(`${kind}:pair:approved:${userCode}`, '1'))) return 'used';
	// A pairing started before origins were stored has none: DMM_ORIGIN, as it was then.
	const origin = pairing.origin ?? process.env.DMM_ORIGIN ?? 'https://debridmediamanager.com';
	return (await s.replace(
		deviceKey(kind, deviceCode),
		JSON.stringify({ ...pairing, link: link(origin) })
	))
		? 'ok'
		: 'unknown';
}

/** The link once, on the first poll after approval; 'pending' before; 'expired' after. */
export async function collectPairing<L>(
	kind: PairingKind,
	deviceCode: string
): Promise<L | 'pending' | 'expired'> {
	const s = store();
	const raw = await s.get(deviceKey(kind, deviceCode));
	if (!raw) return 'expired';
	const pairing = JSON.parse(raw) as Pairing<L>;
	if (!pairing.link) return 'pending';
	// Only the poll whose delete removed the key gets the link.
	if (!(await s.del(deviceKey(kind, deviceCode)))) return 'expired';
	await s.del(codeKey(kind, pairing.userCode));
	return pairing.link;
}
