import { resolveJobServer } from '@/services/debridUploaderServers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { registerCompletedDebridJob } from '@/services/transferRegistration';
import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id, mediaType, seasonNum } = req.query;
	if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) {
		return res.status(400).json({ error: 'Invalid job id' });
	}

	// A job lives only on the server that created it, so route to that host.
	const server = await resolveJobServer(id, (j) => db.getDebridJobServer(j));
	if (!server) {
		return res.status(502).json({ error: 'Debrid uploader service unreachable' });
	}

	try {
		const response = await fetch(`${server}/jobs/${id}`, {
			method: req.method,
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(15000),
		});
		const data = await response.json();

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

		return res.status(response.status).json(data);
	} catch (error) {
		console.error('Debrid uploader job request failed:', error);
		return res.status(502).json({ error: 'Debrid uploader service unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
