import { repository as db } from '@/services/repository';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { plexServerOwner } from '@/utils/plexServerOwner';
import { issueRexDirectCert, rexDirectCertCoversLan } from '@/utils/rexDirectAcme';
import {
	isGlobalIpv6,
	isRfc1918Ipv4,
	removeRexDirectRecords,
	rexDirectHostname,
	rexDirectLanHostname,
	upsertRexDirectRecord,
} from '@/utils/rexDirectDns';
import { answersAsMachine } from '@/utils/rexDirectReach';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * rex-direct: give a rex server its own `<hash>.rex-direct.debridmediamanager.com`
 * name pointed at its home IP, and a certificate for it. dmm's own plex.direct, so
 * Plex clients reach a rex server over HTTPS from anywhere without the operator
 * owning a domain. The server calls this once claimed and every 6 h (dynamic DNS);
 * the contract is rex's `docs/rex-direct-api.md`.
 *
 * Open to any rex claimed on a Plex account: the caller sends its claim's server
 * token, and plex.tv must list a server with this machineIdentifier as owned by
 * that account. Each server gets a certificate of its own (`utils/rexDirectAcme`),
 * ordered in the background: until it is stored the answer is 202 with retryAfter.
 *
 * A server may also send `lanIp`, its address on its home network, for a LAN name
 * `lan.<hash>…` that reaches it over HTTPS at home without a port forward. Its
 * certificate covers `*.<hash>…` for that; one from before LAN names is reordered in
 * the background while the old one is still answered, and `lanHostname` is returned
 * only once the answered certificate covers it.
 *
 * The sponsor-key path (`x-api-key`) is what rex builds before 2026-10-19 send;
 * they get the shared wildcard as before and no LAN name. The public A record is
 * always the request's source IP, never a caller-supplied one. The LAN record is
 * caller-supplied, which is safe only because it must be an RFC 1918 address: those
 * are not routable, so nobody can aim our domain at a public host through it. A
 * server only ever touches its own hash.
 *
 * A claimed server may also send `publicIpv6` and `port`: an AAAA on its public name
 * reaches it on a connection with no public IPv4 (CGNAT, DS-Lite) but a global IPv6. DMM
 * is reached over IPv4 only, so that address is caller-supplied; DMM connects back to it
 * and writes the AAAA only when the same server answers there (`rexDirectReach`). An
 * empty or unreachable `publicIpv6` drops the AAAA, so a lost address stops attracting
 * clients. A caller that sends no `publicIpv6` key leaves the AAAA alone.
 */
const MAX_NAMES_PER_ACCOUNT = 10;
const RENEW_BEFORE_MS = 30 * 24 * 3600_000;
const RETRY_AFTER_S = 60;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	// A Plex machineIdentifier is a 40-char hex SHA-1; accept hex up to 64 to be
	// safe, and nothing else (it becomes the primary key and must not be junk).
	const machineIdentifier =
		typeof req.body?.machineIdentifier === 'string' ? req.body.machineIdentifier.trim() : '';
	if (!/^[0-9a-f]{20,64}$/i.test(machineIdentifier)) {
		return res.status(400).json({ error: 'Invalid machineIdentifier' });
	}

	const plexToken = req.headers['x-plex-token'];
	const apiKey = req.headers['x-api-key'];
	let plexAccountId: string | null = null;
	let shortId: string | null = null;
	if (plexToken && typeof plexToken === 'string') {
		const owner = await plexServerOwner(plexToken, machineIdentifier);
		if ('error' in owner) return res.status(owner.status).json({ error: owner.error });
		plexAccountId = owner.accountId;
	} else if (apiKey && typeof apiKey === 'string') {
		const sponsor = await db.getSponsorByDmmApiKey(apiKey);
		if (!sponsor) return res.status(401).json({ error: 'Invalid API key' });
		if (!sponsor.isSponsor) {
			return res.status(401).json({ error: 'Sponsorship is no longer active' });
		}
		shortId = sponsor.shortId;
	} else {
		return res
			.status(401)
			.json({ error: 'Missing X-Plex-Token header: claim the server first' });
	}

	// Only a claimed server gets a LAN name; the sponsor-key path ignores lanIp.
	const lanIp = plexAccountId && typeof req.body?.lanIp === 'string' ? req.body.lanIp : '';
	if (lanIp && !isRfc1918Ipv4(lanIp)) {
		return res.status(400).json({ error: 'Invalid lanIp' });
	}

	const ip = getClientIpFromRequest(req);
	if (!/^[0-9.]{7,15}$/.test(ip) && !ip.includes(':')) {
		return res.status(400).json({ error: 'Could not determine a source IP' });
	}

	// A free Plex account can claim any number of servers, so cap the names one
	// account holds: each is a record under our domain with a valid certificate.
	if (
		plexAccountId &&
		!(await db.rexDirectExists(machineIdentifier)) &&
		(await db.rexDirectCountByPlexAccount(plexAccountId)) >= MAX_NAMES_PER_ACCOUNT
	) {
		return res
			.status(429)
			.json({ error: `At most ${MAX_NAMES_PER_ACCOUNT} servers per Plex account` });
	}

	const wildcard = shortId ? await db.rexDirectGetCert() : null;
	if (shortId && !wildcard) {
		// The renewal cron has not stored the wildcard cert yet; without it a name
		// would resolve to a server with no cert to serve, so refuse rather than
		// hand out a half-working setup.
		return res.status(503).json({ error: 'rex-direct certificate not provisioned yet' });
	}

	const { hash } = await db.rexDirectGetOrAssignHash(
		machineIdentifier,
		plexAccountId ? { plexAccountId } : { shortId: shortId! }
	);
	const hostname = rexDirectHostname(hash);

	// Only write DNS when the IP actually changed; an unchanged heartbeat (every
	// few minutes per server) must not hammer the Cloudflare API.
	const last = await db.rexDirectLastIp(machineIdentifier);
	if (last !== ip) {
		await upsertRexDirectRecord(hostname, ip);
		await db.rexDirectRecordIp(machineIdentifier, ip);
	}
	if (lanIp && (await db.rexDirectLastLanIp(machineIdentifier)) !== lanIp) {
		await upsertRexDirectRecord(rexDirectLanHostname(hash), lanIp);
		await db.rexDirectRecordLanIp(machineIdentifier, lanIp);
	}

	// Only a claimed server gets an AAAA, and only where it answers as itself.
	let ipv6: string | null = null;
	if (plexAccountId && typeof req.body?.publicIpv6 === 'string') {
		const candidate = req.body.publicIpv6.trim();
		const port = Number(req.body?.port);
		const reaches =
			isGlobalIpv6(candidate) &&
			Number.isInteger(port) &&
			port > 0 &&
			port < 65536 &&
			(await answersAsMachine(candidate, port, machineIdentifier));
		if (reaches) {
			ipv6 = candidate;
			await upsertRexDirectRecord(hostname, candidate, 'AAAA');
		} else {
			await removeRexDirectRecords(hostname, 'AAAA');
		}
	}

	if (wildcard) {
		return res.status(200).json({
			hostname,
			hash,
			ip,
			certificate: wildcard.fullchain,
			privateKey: wildcard.privkey,
		});
	}

	const cert = await db.rexDirectServerCert(machineIdentifier);
	const now = Date.now();
	// A certificate from before LAN names lacks the wildcard: reorder it and answer 202
	// meanwhile. rex keeps serving the answer it kept and asks again in a minute, where
	// a 200 without the LAN name would have it wait for its next 6-hourly call.
	const coversLan = !!lanIp && !!cert && rexDirectCertCoversLan(cert.certificate, hostname);
	const usable = !!cert && cert.expiresAt.getTime() > now && (!lanIp || coversLan);
	if (!cert || cert.expiresAt.getTime() - now < RENEW_BEFORE_MS || !usable) {
		await orderCertificate(machineIdentifier, hostname);
	}
	if (!usable) {
		res.setHeader('Retry-After', String(RETRY_AFTER_S));
		return res.status(202).json({
			hostname,
			retryAfter: RETRY_AFTER_S,
			error: 'Certificate being issued',
		});
	}
	return res.status(200).json({
		hostname,
		hash,
		ip,
		...(ipv6 && { ipv6 }),
		...(coversLan && { lanHostname: rexDirectLanHostname(hash), lanIp }),
		certificate: cert.certificate,
		privateKey: cert.privateKey,
	});
}

/** Start an order unless one is running; it outlives the request (a long-running Next server). */
async function orderCertificate(machineIdentifier: string, hostname: string): Promise<void> {
	if (!(await db.rexDirectStartIssuing(machineIdentifier))) return;
	void issueRexDirectCert(hostname)
		.then((issued) =>
			db.rexDirectStoreServerCert(
				machineIdentifier,
				issued.certificate,
				issued.privateKey,
				issued.expiresAt
			)
		)
		.catch(async (error) => {
			console.error(`rex-direct: certificate for ${hostname} failed:`, error);
			await db.rexDirectBackOffIssuing(machineIdentifier).catch(() => undefined);
		});
}
