import { repository as db } from '@/services/repository';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { rexDirectHostname, upsertRexDirectRecord } from '@/utils/rexDirectDns';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * rex-direct: give a sponsor's rex server its own
 * `<hash>.rex-direct.debridmediamanager.com` name pointed at its home IP, and the
 * shared wildcard cert that covers it. dmm's own plex.direct, so Plex clients
 * reach a rex server over HTTPS from anywhere without the operator owning a
 * domain. The server calls this on start and periodically (dynamic DNS).
 *
 * Gated on an active sponsorship via the DMM API key, exactly like the zurg
 * endpoints (`api/zurg/auth.ts`): rex already carries this key for the metadata
 * API. The A record is always set to the request's source IP, never a
 * caller-supplied one, and a server only ever touches its own hash. To tighten
 * from "any active sponsor" to a narrower set, change the `isSponsor` check.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const apiKey = req.headers['x-api-key'];
	if (!apiKey || typeof apiKey !== 'string') {
		return res.status(401).json({ error: 'Missing x-api-key header' });
	}
	const sponsor = await db.getSponsorByDmmApiKey(apiKey);
	if (!sponsor) {
		return res.status(401).json({ error: 'Invalid API key' });
	}
	if (!sponsor.isSponsor) {
		return res.status(401).json({ error: 'Sponsorship is no longer active' });
	}

	// A Plex machineIdentifier is a 40-char hex SHA-1; accept hex up to 64 to be
	// safe, and nothing else (it becomes the primary key and must not be junk).
	const machineIdentifier =
		typeof req.body?.machineIdentifier === 'string' ? req.body.machineIdentifier.trim() : '';
	if (!/^[0-9a-f]{20,64}$/i.test(machineIdentifier)) {
		return res.status(400).json({ error: 'Invalid machineIdentifier' });
	}

	const ip = getClientIpFromRequest(req);
	if (!/^[0-9.]{7,15}$/.test(ip) && !ip.includes(':')) {
		return res.status(400).json({ error: 'Could not determine a source IP' });
	}

	const cert = await db.rexDirectGetCert();
	if (!cert) {
		// The renewal cron has not stored the wildcard cert yet; without it a name
		// would resolve to a server with no cert to serve, so refuse rather than
		// hand out a half-working setup.
		return res.status(503).json({ error: 'rex-direct certificate not provisioned yet' });
	}

	const { hash } = await db.rexDirectGetOrAssignHash(machineIdentifier, sponsor.shortId);

	// Only write DNS when the IP actually changed; an unchanged heartbeat (every
	// few minutes per server) must not hammer the Cloudflare API.
	const last = await db.rexDirectLastIp(machineIdentifier);
	if (last !== ip) {
		await upsertRexDirectRecord(hash, ip);
		await db.rexDirectRecordIp(machineIdentifier, ip);
	}

	return res.status(200).json({
		hostname: rexDirectHostname(hash),
		hash,
		ip,
		certificate: cert.fullchain,
		privateKey: cert.privkey,
	});
}
