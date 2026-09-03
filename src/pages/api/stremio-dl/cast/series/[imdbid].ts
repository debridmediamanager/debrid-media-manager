import { repository as db } from '@/services/repository';
import {
	describeDebridLinkError,
	generateDebridLinkUserId,
	resolveDebridLinkRelease,
} from '@/utils/debridLinkCastApiHelpers';
import { matchDebridLinkFile, type DebridLinkVideoFile } from '@/utils/debridLinkCastFiles';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

// SERIES cast: one add resolves the whole release, then every episode in it is
// stored under its own `imdbid:season:episode` key.
//
// `filenames` is optional and names a subset. Leaving it out is the normal
// case, and the button must never be gated on a client-side file list - that is
// what made Cast (PM) a movies-only button, and here it would be worse than a
// mistake: Debrid-Link publishes no cache probe at all, so a browser holding
// only a Debrid-Link credential has no way to build such a list.
//
// One add per cast, whatever the episode count. That add spends one of the
// caster's 50 daily torrents when the release is not already in their seedbox -
// the same cost as adding it from the search page, and the reason a quota
// refusal comes back as a sentence rather than a 500.
//
// Episodes are addressed by filename, not by index: a positional index is
// exactly what makes the other providers cast the wrong episode, and
// Debrid-Link's own file ids are not stable enough to key a cast row on.
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
		const release = await resolveDebridLinkRelease(apiKey, hash);

		if (!release.finished) {
			res.status(409).json({
				status: 'error',
				errorMessage: `Debrid-Link is still downloading this release (${release.percent}%) - cast it again once it finishes`,
			});
			return;
		}

		const files = release.files;
		const userid = await generateDebridLinkUserId(apiKey);

		const targets: (DebridLinkVideoFile | string)[] = wholeRelease ? files : requested;

		for (const target of targets) {
			const file = typeof target === 'string' ? matchDebridLinkFile(files, target) : target;
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

			await db.saveDebridLinkCast(
				`${imdbid}:${info.season}:${info.episode}`,
				userid,
				hash,
				file.filename,
				Math.round(file.size / 1024 / 1024),
				file.path,
				file.link ?? undefined
			);
			casted += 1;
		}

		if (wholeRelease && casted === 0) {
			res.status(404).json({
				status: 'error',
				errorMessage: 'No episodes in this release on Debrid-Link',
			});
			return;
		}

		res.status(200).json({
			status: errorEpisodes.length === 0 ? 'success' : 'partial',
			casted,
			errorEpisodes,
		});
	} catch (error) {
		const message = describeDebridLinkError(error);
		console.error('Failed to cast series to Debrid-Link:', message);
		res.status(500).json({ status: 'error', errorMessage: message });
	}
}
