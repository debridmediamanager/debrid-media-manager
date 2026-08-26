import { directDownloadPremiumize } from '@/services/premiumize';
import { repository as db } from '@/services/repository';
import { generatePremiumizeUserId } from '@/utils/premiumizeCastApiHelpers';
import {
	matchPremiumizeFile,
	premiumizeVideoFiles,
	type PremiumizeVideoFile,
} from '@/utils/premiumizeCastFiles';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

// SERIES cast: one directdl resolves the whole release, then every episode in
// it is stored under its own `imdbid:season:episode` key.
//
// `filenames` is optional and names a subset. Leaving it out is the normal
// case: `cache/check` is the only availability probe of the four that returns
// no file listing at all, so a browser holding only a Premiumize key never
// learns the episode filenames - and gating the cast button on a client-side
// listing is what made Cast (PM) a movies-only button. The directdl below is
// that listing, so the episodes are resolved here instead.
//
// Episodes are addressed by filename, not by index or id: Premiumize has no
// per-file id, and a positional index is exactly what makes the other providers
// cast the wrong episode.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { imdbid } = req.query;
	const { hash, filenames } = req.body ?? {};
	const apiKey = readProviderKey(req, ['apiKey']);

	if (!apiKey || typeof imdbid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "apiKey", "imdbid" or "hash"',
		});
		return;
	}

	const requested: string[] = Array.isArray(filenames)
		? filenames.filter((name: unknown): name is string => typeof name === 'string')
		: [];
	const wholeRelease = requested.length === 0;

	const errorEpisodes: string[] = [];
	let casted = 0;

	try {
		const files = premiumizeVideoFiles(await directDownloadPremiumize(apiKey, hash));
		const userid = await generatePremiumizeUserId(apiKey);

		const targets: (PremiumizeVideoFile | string)[] = wholeRelease ? files : requested;

		for (const target of targets) {
			const file = typeof target === 'string' ? matchPremiumizeFile(files, target) : target;
			if (!file) {
				errorEpisodes.push(`${target} (not in this release)`);
				continue;
			}

			const info = ptt.parse(file.filename);
			// The bare imdb id is the *movie* key, and the table is unique on
			// (imdbId, userId, hash) - writing an episode there would overwrite
			// whatever else this release already cast.
			if (info.season == null || info.episode == null) {
				// An extra, a sample or a featurette when we picked the files
				// ourselves - not something the caller asked for and failed to get.
				if (!wholeRelease) {
					errorEpisodes.push(`${file.filename} (no episode number in filename)`);
				}
				continue;
			}

			await db.savePremiumizeCast(
				`${imdbid}:${info.season}:${info.episode}`,
				userid,
				hash,
				file.filename,
				Math.round(file.size / 1024 / 1024),
				file.path
			);
			casted += 1;
		}

		if (wholeRelease && casted === 0) {
			res.status(404).json({
				status: 'error',
				errorMessage: 'No episodes in this release on Premiumize',
			});
			return;
		}

		res.status(200).json({
			status: errorEpisodes.length === 0 ? 'success' : 'partial',
			casted,
			errorEpisodes,
		});
	} catch (error) {
		console.error(
			'Failed to cast series to Premiumize:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
