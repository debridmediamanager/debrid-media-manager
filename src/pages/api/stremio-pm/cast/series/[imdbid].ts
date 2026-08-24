import { directDownloadPremiumize } from '@/services/premiumize';
import { repository as db } from '@/services/repository';
import { generatePremiumizeUserId } from '@/utils/premiumizeCastApiHelpers';
import { matchPremiumizeFile, premiumizeVideoFiles } from '@/utils/premiumizeCastFiles';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

// SERIES cast: one directdl resolves the whole release, then each requested
// episode is stored under its own `imdbid:season:episode` key.
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
	if (!Array.isArray(filenames) || filenames.length === 0) {
		res.status(400).json({ status: 'error', errorMessage: 'Missing "filenames"' });
		return;
	}

	const errorEpisodes: string[] = [];

	try {
		const files = premiumizeVideoFiles(await directDownloadPremiumize(apiKey, hash));
		const userid = await generatePremiumizeUserId(apiKey);

		for (const requested of filenames) {
			if (typeof requested !== 'string') continue;

			const file = matchPremiumizeFile(files, requested);
			if (!file) {
				errorEpisodes.push(`${requested} (not in this release)`);
				continue;
			}

			const info = ptt.parse(file.filename);
			// The bare imdb id is the *movie* key, and the table is unique on
			// (imdbId, userId, hash) - writing an episode there would overwrite
			// whatever else this release already cast.
			if (info.season == null || info.episode == null) {
				errorEpisodes.push(`${file.filename} (no episode number in filename)`);
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
		}

		res.status(200).json({
			status: errorEpisodes.length === 0 ? 'success' : 'partial',
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
