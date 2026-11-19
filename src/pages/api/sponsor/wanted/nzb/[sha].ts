import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { hasTokenSecret } from '@/services/newznab/opaqueId';
import { isStoreConfigured, putStoredNzb } from '@/services/newznab/store';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { NZB_SHA, WANTED_NZB_PREFIX } from '@/services/wantedHistory';
import { NzbSanitizeError } from '@/utils/nzbSanitize';
import { cleanUploadedNzb, MAX_UPLOADED_NZB } from '@/utils/nzbUpload';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';

// Read by hand: the body is XML, and its size is bounded here, inflated or not.
export const config = { api: { bodyParser: false } };

/** The body, inflated when sent gzipped; null once it passes `MAX_UPLOADED_NZB`. */
async function readBody(req: NextApiRequest): Promise<Buffer | null> {
	const stream = req.headers['content-encoding'] === 'gzip' ? req.pipe(createGunzip()) : req;
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of stream) {
		size += chunk.length;
		if (size > MAX_UPLOADED_NZB) return null;
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

/**
 * An NZB a sponsor's zurg grabbed from its own indexer, uploaded for other sponsors'
 * zurgs. The path names the sha256 of the body (inflated, when sent gzipped), which
 * must be one this sponsor reported as grabbed and DMM asked for in `want_nzb`: 404
 * otherwise, 400 when the bytes do not hash to it or are not an NZB. zurg anonymized
 * the file already; it is rebuilt here regardless (utils/nzbUpload) and that copy is
 * what is stored, under `wanted:<sha>`, with no record of who sent it. Safe to repeat.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'PUT') {
		res.setHeader('Allow', 'PUT');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const sponsor = await sponsorOfDmmApiKeyHeader(req, res);
	if (!sponsor) return;
	if (
		!(await checkRateLimitFor(
			`sponsor:${sponsor.shortId}`,
			RATE_LIMIT_CONFIGS.sponsorWantedNzb,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	const sha = req.query.sha;
	if (typeof sha !== 'string' || !NZB_SHA.test(sha)) {
		return res.status(400).json({ error: 'Expected the sha256 of the NZB, 64 lowercase hex' });
	}
	if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOADED_NZB) {
		return res.status(413).json({ error: 'An uploaded NZB is at most 8 MB' });
	}
	if (!isStoreConfigured() || !hasTokenSecret()) {
		return res.status(503).json({ error: 'DMM cannot store NZBs right now' });
	}

	try {
		if (!(await db.reportedWantedNzb(sponsor.shortId, sha))) {
			return res.status(404).json({ error: 'DMM did not ask for that NZB' });
		}
		if ((await db.heldWantedNzbs([sha])).has(sha)) return res.status(200).json({ ok: true });

		let body: Buffer | null;
		try {
			body = await readBody(req);
		} catch {
			return res.status(400).json({ error: 'The body could not be read' });
		}
		if (!body) return res.status(413).json({ error: 'An uploaded NZB is at most 8 MB' });
		if (createHash('sha256').update(body).digest('hex') !== sha) {
			return res.status(400).json({ error: 'The body does not hash to that sha256' });
		}
		let xml: string;
		try {
			xml = await cleanUploadedNzb(body.toString('utf8'));
		} catch (error) {
			if (error instanceof NzbSanitizeError) {
				return res.status(400).json({ error: error.message });
			}
			throw error;
		}
		// putStoredNzb answers false rather than throwing; only a stored NZB is marked held.
		if (!(await putStoredNzb(WANTED_NZB_PREFIX, sha, xml))) {
			return res.status(503).json({ error: 'DMM could not store the NZB; try again' });
		}
		await db.markWantedNzbHeld(sha);
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error('[sponsor/wanted/nzb] failed', error);
		return res.status(500).json({ error: 'Could not take the NZB' });
	}
}
