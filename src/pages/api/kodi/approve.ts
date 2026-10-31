import { approvePairing, KodiAccount, normalizeUserCode } from '@/services/kodiPairing';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { NextApiRequest, NextApiResponse } from 'next';

/** Each DMM Cast addon a Kodi can be handed, keyed like the browser's `<service>:castToken`. */
const CAST_ADDONS: Record<
	string,
	{ name: string; prefix: string; exists: (id: string) => Promise<unknown> }
> = {
	rd: { name: 'Real-Debrid', prefix: 'stremio', exists: (id) => db.getCastProfile(id) },
	tb: { name: 'TorBox', prefix: 'stremio-tb', exists: (id) => db.getTorBoxCastProfile(id) },
	ad: { name: 'AllDebrid', prefix: 'stremio-ad', exists: (id) => db.getAllDebridCastProfile(id) },
	pm: {
		name: 'Premiumize',
		prefix: 'stremio-pm',
		exists: (id) => db.getPremiumizeCastProfile(id),
	},
	oc: { name: 'Offcloud', prefix: 'stremio-oc', exists: (id) => db.getOffcloudCastProfile(id) },
	dl: {
		name: 'Debrid-Link',
		prefix: 'stremio-dl',
		exists: (id) => db.getDebridLinkCastProfile(id),
	},
};

const CAST_ID = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * The signed-in browser approving a Kodi's code with the DMM Cast addons it holds
 * (`casts: {rd: "<userid>", ...}`) and, for a sponsor, the DMM API key.
 *
 * A cast id is the same capability the Stremio install URL carries, so holding it
 * is the proof; each is still checked against its profile so a stale id left in
 * localStorage is dropped rather than handed to Kodi. A key that is not an active
 * sponsorship is left out instead of failing the pairing: the casts still work.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userCode = normalizeUserCode(req.body?.userCode);
	if (!userCode) {
		return res.status(400).json({ error: 'That is not a Kodi code. It looks like ABCD-EFGH.' });
	}
	const casts = req.body?.casts && typeof req.body.casts === 'object' ? req.body.casts : {};
	const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';

	try {
		const origin = process.env.DMM_ORIGIN || 'https://debridmediamanager.com';
		const accounts: KodiAccount[] = [];
		for (const [service, addon] of Object.entries(CAST_ADDONS)) {
			const id = casts[service];
			if (typeof id !== 'string' || !CAST_ID.test(id) || !(await addon.exists(id))) continue;
			accounts.push({
				service,
				name: addon.name,
				addon: `${origin}/api/${addon.prefix}/${id}`,
			});
		}
		const lookup = apiKey ? await db.getSponsorByDmmApiKey(apiKey) : null;
		const sponsor = lookup?.isSponsor
			? { apiKey, githubUsername: lookup.githubUsername }
			: null;

		if (!accounts.length && !sponsor) {
			return res.status(400).json({
				error: 'Nothing to link yet. Sign in to a debrid service on DMM first, then try again.',
			});
		}

		const result = await approvePairing(
			userCode,
			{ accounts, sponsor },
			getClientIpFromRequest(req),
			req.body?.confirmOtherNetwork === true
		);
		if (result === 'other-network') {
			return res.status(428).json({
				otherNetwork: true,
				error: 'This Kodi is on a different internet connection from this browser. Link it only if the code is on your own TV right now. A link someone sent you could be theirs.',
			});
		}
		if (result === 'unknown') {
			return res.status(404).json({
				error: 'Kodi does not know that code. Check it, or open Link this Kodi again for a new one.',
			});
		}
		if (result === 'used') {
			return res.status(409).json({
				error: 'That code was already used. Kodi shows a new one if you start again.',
			});
		}
		return res.status(200).json({
			accounts: accounts.map(({ service, name }) => ({ service, name })),
			sponsor: sponsor !== null,
		});
	} catch (error) {
		console.error('[kodi/approve] failed:', error instanceof Error ? error.message : error);
		return res
			.status(503)
			.json({ error: 'Could not link Kodi right now. Try again in a minute.' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.kodiApprove);
