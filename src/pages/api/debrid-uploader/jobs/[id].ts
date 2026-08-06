import {
	buildTransferRegistration,
	originalHashFromInput,
	parseTransferContext,
	TransferJobFile,
} from '@/services/debridUploaderRegistration';
import { resolveJobServer } from '@/services/debridUploaderServers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// When a poll observes a completed job, register the rewritten torrent in DMM's
// DB (search row + RD availability) so it surfaces as an RD-cached result for
// everyone. Runs server-side off whichever client happens to poll — the send
// loop, the Transfers page, or a dedupe re-check — and is idempotent: an
// already-available hash is skipped. `server` is the host that owns this job.
async function registerCompletedJob(
	job: any,
	mediaType: unknown,
	seasonNum: unknown,
	server: string
) {
	const rewrittenHash = typeof job?.info_hash === 'string' ? job.info_hash.toLowerCase() : '';
	if (!/^[a-f0-9]{40}$/.test(rewrittenHash)) return false;

	// Always link the original hash to this completed transfer so any user's send
	// flow can dedup against it, even if the scraped/availability registration is
	// skipped (already registered, or no page context to file it under).
	const originalHash = originalHashFromInput(job.input);
	if (originalHash && job.imdb_id) {
		await db
			.recordDebridTransferCompleted(originalHash, job.id, job.imdb_id, rewrittenHash)
			.catch((e) => console.error('Recording completed transfer failed (non-fatal):', e));
	}

	const context = parseTransferContext(mediaType, seasonNum);
	if (!context) return false;

	const already = await db.checkAvailabilityByHashes([rewrittenHash]);
	if (already.length > 0) return false;

	const filesResponse = await fetch(`${server}/jobs/${job.id}/files`, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(15000),
	});
	if (!filesResponse.ok) return false;
	const files = (await filesResponse.json()) as TransferJobFile[];
	if (!Array.isArray(files)) return false;

	const registration = buildTransferRegistration({
		infoHash: rewrittenHash,
		imdbId: job.imdb_id,
		name: job.name,
		files,
		context,
		endedAt: job.completed_at,
	});
	if (!registration) return false;

	await db.saveScrapedTrueResults(registration.scrapedKey, [registration.scrapeEntry], true);
	await db.upsertAvailability(registration.availability);
	return true;
}

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
				data.dmm_registered = await registerCompletedJob(
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
