import { readArrWanted } from '@/services/arrBackup';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { seasonsTmdbLacks } from '@/services/wanted';
import { requireSponsor } from '@/utils/requireSponsor';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

export const config = { api: { bodyParser: false } };

/** Compressed upload: fun's 2,449-film Radarr is 19 MB, its 221-show Sonarr 20 MB. */
const MAX_UPLOAD = 200 << 20;
/** Inflated database; the same Sonarr is 248 MB. */
const MAX_DATABASE = 2 * 1024 ** 3;

export interface WantedImportResponse {
	app: 'radarr' | 'sonarr';
	found: number;
	added: number;
	alreadyWanted: number;
	overCap: number;
	noImdbId: number;
	notAvailable: number;
	/** Sonarr seasons TMDB, which the list follows, has nothing aired in; zurg will not fetch them. */
	seasonsTmdbLacks: { title: string; seasons: number[] }[];
}

/**
 * Imports what a Radarr or Sonarr backup is searching for into the sponsor's
 * wanted list. The body is the `.db` member of the backup zip, still deflated
 * as the zip holds it: the page cuts it out, so the rest of the backup, the
 * arr's API key in `config.xml` included, never leaves the browser.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const payload = await requireSponsor(req, res);
	if (!payload) return;
	if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) {
		return res.status(413).json({ error: 'That backup is too large' });
	}
	if (
		!(await checkRateLimitFor(
			`wantedImport:${payload.shortId}`,
			RATE_LIMIT_CONFIGS.wantedImport,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}

	const dir = await mkdtemp(join(tmpdir(), 'dmm-arr-import-'));
	try {
		const path = join(dir, 'arr.db');
		let size = 0;
		const capped = new Transform({
			transform(chunk: Buffer, _encoding, done) {
				size += chunk.length;
				done(size > MAX_DATABASE ? new Error('database too large') : null, chunk);
			},
		});
		try {
			await pipeline(req, createInflateRaw(), capped, createWriteStream(path));
		} catch {
			return res
				.status(400)
				.json({ error: 'Could not unpack the database from that backup' });
		}
		let found;
		try {
			found = readArrWanted(path);
		} catch {
			found = null;
		}
		if (!found) {
			return res.status(400).json({ error: 'That is not a Radarr or Sonarr backup' });
		}
		const result = await db.wantMany(payload.shortId, found.wanted);
		const body: WantedImportResponse = {
			app: found.app,
			found: found.wanted.length,
			...result,
			noImdbId: found.noImdbId,
			notAvailable: found.notAvailable,
			seasonsTmdbLacks: found.app === 'sonarr' ? await seasonsTmdbLacks(found.wanted) : [],
		};
		return res.status(200).json(body);
	} catch (error) {
		console.error('[wanted/import] failed', error);
		return res.status(500).json({ error: 'Could not import that backup' });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
