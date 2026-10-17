import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Store the current `*.rex-direct.debridmediamanager.com` wildcard cert, so the
 * register endpoint can hand it to rex servers. Called only by the renewal cron
 * on dmm-01 after certbot issues/renews it; the dmm_web container has no host
 * mount, so the cert reaches it this way rather than off disk.
 *
 * Guarded by a shared secret in `REXDIRECT_CERT_UPLOAD_SECRET` (server env, never
 * committed), not the sponsor gate: the caller is our own cron, not a rex server.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'PUT') {
		res.setHeader('Allow', 'PUT');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const secret = process.env.REXDIRECT_CERT_UPLOAD_SECRET;
	if (!secret) {
		return res.status(503).json({ error: 'cert upload not configured' });
	}
	if (req.headers['x-rex-direct-secret'] !== secret) {
		return res.status(401).json({ error: 'unauthorized' });
	}
	const fullchain = typeof req.body?.fullchain === 'string' ? req.body.fullchain : '';
	const privkey = typeof req.body?.privkey === 'string' ? req.body.privkey : '';
	if (!fullchain.includes('BEGIN CERTIFICATE') || !privkey.includes('BEGIN ')) {
		return res.status(400).json({ error: 'fullchain and privkey (PEM) required' });
	}
	await db.rexDirectSetCert(fullchain, privkey);
	return res.status(200).json({ stored: true });
}
