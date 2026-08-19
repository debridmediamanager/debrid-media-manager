import { getNzb2rdUrl } from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { registerCompletedNzb2rdJob } from '@/services/transferRegistration';
import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id, mediaType, seasonNum, releaseId } = req.query;
	if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) {
		return res.status(400).json({ error: 'Invalid job id' });
	}
	const release =
		typeof releaseId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(releaseId)
			? releaseId
			: undefined;

	try {
		// The caller's RD key is forwarded, never interpreted: nzb2rd authorizes
		// the delete against the job's owner, and this route has no idea who owns
		// what. Without it a cancel is refused there, which is the point — this
		// endpoint is public and used to forward any id straight through.
		const rdKey = req.headers['x-rd-api-key'];
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (typeof rdKey === 'string' && rdKey) headers['x-rd-api-key'] = rdKey;

		const response = await fetch(`${getNzb2rdUrl()}/jobs/${encodeURIComponent(id)}`, {
			method: req.method,
			headers,
			signal: AbortSignal.timeout(15000),
		});
		const data = await response.json().catch(() => ({}));

		// A cancelled job must not keep blocking a resubmit of the same release.
		if (req.method === 'DELETE' && response.ok && release) {
			await db
				.removeNzb2rdTransfer(release)
				.catch((e) => console.error('Clearing nzb2rd transfer failed:', e));
		}

		if (req.method === 'GET' && response.ok && data?.status === 'completed') {
			try {
				data.dmm_registered = await registerCompletedNzb2rdJob(
					data,
					mediaType,
					seasonNum,
					release
				);
			} catch (error) {
				console.error('nzb2rd registration failed:', error);
			}
		}

		return res.status(response.status).json(data);
	} catch (error) {
		console.error('nzb2rd job request failed:', error);
		return res.status(502).json({ error: 'nzb2rd service unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
