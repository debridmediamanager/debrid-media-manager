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

		// A failed job must stop blocking a resubmit of the same release, exactly
		// as a cancelled one does. Without this the `nzbrd:` marker stays
		// `pending` for good and the Usenet row shows a disabled "Running" to
		// every user, while the resubmit the server would happily accept is
		// unreachable from the UI.
		//
		// Recorded rather than deleted: deleting returned the row to a bare
		// "Send", which unblocks the resubmit but hides that this release was
		// already tried. The `failed` marker renders an enabled Retry carrying
		// nzb2rd's own reason, and is just as invisible to the dedup check.
		if (req.method === 'GET' && response.ok && release && data?.status === 'failed') {
			await db
				.recordNzb2rdTransferFailed(
					release,
					id,
					typeof data.imdb_id === 'string' ? data.imdb_id : '',
					typeof data.error === 'string' ? data.error : undefined
				)
				.catch((e) => console.error('Recording a failed nzb2rd transfer failed:', e));
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
