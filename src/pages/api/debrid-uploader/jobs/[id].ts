import { resolveJobServer } from '@/services/debridUploaderServers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getCurrentUser } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { registerCompletedDebridJob } from '@/services/transferRegistration';
import { settleCancelledDebridJob } from '@/utils/debridJobOutcome';
import { publicDebridJob } from '@/utils/publicDebridJob';
import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id, mediaType, seasonNum } = req.query;
	if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) {
		return res.status(400).json({ error: 'Invalid job id' });
	}

	let callerOwner: string | undefined;
	if (req.method === 'DELETE') {
		const rdKey = req.headers['x-rd-api-key'];
		if (typeof rdKey !== 'string' || !rdKey) {
			return res.status(401).json({ error: 'x-rd-api-key required' });
		}
		try {
			const user = await getCurrentUser(rdKey);
			if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Invalid user id');
			callerOwner = `rd:${user.id}`;
		} catch {
			return res.status(401).json({ error: 'Unable to verify Real-Debrid account' });
		}
	}

	// A job lives only on the server that created it, so route to that host.
	const server = await resolveJobServer(id, (j) => db.getDebridJobServer(j));
	if (!server) {
		return res.status(502).json({ error: 'Debrid uploader service unreachable' });
	}

	try {
		if (req.method === 'DELETE') {
			// This DMM integration creates RD-destination jobs only. Do not let
			// an RD source account cancel another provider's destination job.
			const ownershipResponse = await fetch(`${server}/jobs/${id}`, {
				method: 'GET',
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(15000),
			});
			const job = await ownershipResponse.json();
			if (!ownershipResponse.ok) {
				return res.status(ownershipResponse.status).json({ error: 'Unable to read job' });
			}
			if (
				(job?.destination != null && job.destination !== 'rd') ||
				job?.rd_user_id !== callerOwner
			) {
				return res
					.status(403)
					.json({ error: 'Only the destination owner can cancel this job' });
			}
		}
		const response = await fetch(`${server}/jobs/${id}`, {
			method: req.method,
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(15000),
		});
		const body = await response.json();
		// A cancelled job has to read as over here too: this is what a send asks
		// before joining a transfer it tracks, and what it polls while waiting.
		const data = req.method === 'GET' ? settleCancelledDebridJob(body) : body;

		if (req.method === 'GET' && response.ok && data?.status === 'completed') {
			try {
				data.dmm_registered = await registerCompletedDebridJob(
					data,
					mediaType,
					seasonNum,
					server
				);
			} catch (error) {
				console.error('Debrid uploader registration failed:', error);
			}
		}

		return res
			.status(response.status)
			.json(req.method === 'GET' ? publicDebridJob(data) : { ok: response.ok });
	} catch (error) {
		console.error('Debrid uploader job request failed:', error);
		return res.status(502).json({ error: 'Debrid uploader service unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
