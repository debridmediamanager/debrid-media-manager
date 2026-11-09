import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { verifyIdentity } from '@/utils/browserStateIdentity';
import { isSyncedKey, MAX_STATE_BYTES, type SyncIdentity } from '@/utils/browserStateKeys';
import { isNativeAppRequest, validateOwnPageRequest } from '@/utils/ownPageRequest';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * "Remember my logins and settings across devices". DMM has no accounts, so the
 * identity is a provider login the provider verifies on every call, and the
 * state behind it is handed back only to a caller who has just proved it.
 * Credentials ride in JSON bodies only, never the query string.
 */

// Every provider plus parked accounts fits; it bounds the provider calls one request makes.
const MAX_IDENTITIES = 20;

/** The distinct [service, userId] logins the providers accepted. */
async function verified(identities: SyncIdentity[]): Promise<[string, string][]> {
	const userIds = await Promise.all(identities.map(verifyIdentity));
	const logins = new Map<string, [string, string]>();
	identities.forEach((identity, i) => {
		const userId = userIds[i];
		if (userId) logins.set(`${identity.service}:${userId}`, [identity.service, userId]);
	});
	return [...logins.values()];
}

const REFUSED = { error: 'The provider did not accept any of these logins' };

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'PUT' && req.method !== 'POST' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	// It hands credentials back, so another site's script must never reach it. The
	// DMM Library app (a native client, always syncing) proves the same logins.
	if (!isNativeAppRequest(req) && !validateOwnPageRequest(req, res)) return;

	const body = req.body ?? {};

	if (req.method === 'POST') {
		if (!body.identity || typeof body.identity !== 'object') {
			return res.status(400).json({ error: 'Missing identity' });
		}
		const [login] = await verified([body.identity]);
		if (!login) return res.status(401).json(REFUSED);

		const row = await db.getBrowserState(...login);
		if (!row) return res.status(204).end();
		return res
			.status(200)
			.json({ state: JSON.parse(row.state), updatedAt: row.updatedAt.toISOString() });
	}

	const identities = body.identities;
	if (!Array.isArray(identities) || !identities.length || identities.length > MAX_IDENTITIES) {
		return res
			.status(400)
			.json({ error: `identities must be a list of 1 to ${MAX_IDENTITIES} logins` });
	}

	if (req.method === 'DELETE') {
		const logins = await verified(identities);
		if (!logins.length) return res.status(401).json(REFUSED);
		const removed = await Promise.all(logins.map((login) => db.deleteBrowserState(...login)));
		return res.status(200).json({ removed: removed.filter(Boolean).length });
	}

	// Checked before any provider is asked, so a bad body costs no provider calls.
	const state = body.state;
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		return res.status(400).json({ error: 'state must be an object' });
	}
	for (const [key, value] of Object.entries(state)) {
		if (!isSyncedKey(key)) return res.status(400).json({ error: `${key} is not a synced key` });
		if (typeof value !== 'string') {
			return res.status(400).json({ error: `${key} must be a string` });
		}
	}
	const serialized = JSON.stringify(state);
	if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) {
		return res.status(413).json({ error: `state is over ${MAX_STATE_BYTES} bytes` });
	}

	const logins = await verified(identities);
	if (!logins.length) return res.status(401).json(REFUSED);
	await Promise.all(logins.map((login) => db.saveBrowserState(...login, serialized)));
	return res.status(200).json({ saved: logins.length });
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.browserState);
