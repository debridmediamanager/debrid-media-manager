import { repository as db } from '@/services/repository';
import {
	describeDebridLinkError,
	generateDebridLinkUserId,
	resolveDebridLinkRelease,
} from '@/utils/debridLinkCastApiHelpers';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { NextApiRequest, NextApiResponse } from 'next';

// MOVIE cast: resolves the hash once to learn which file is the feature, then
// stores the hash, that file's path and its keyless download URL.
//
// The resolve is `POST /seedbox/add` with the full magnet, because Debrid-Link
// has nothing cheaper: `GET /seedbox/cached` was retired and no batch probe
// replaced it, so the add is the resolve *and* the cache probe. A cached
// release answers complete in one request; an uncached one starts downloading
// for real and spends one of the caster's 50 daily torrents, which is the same
// bargain the search page's add button makes and is why the quota refusals are
// reported in words rather than as a 500.
//
// Nothing is removed afterwards. The add is idempotent by hash, so an add on a
// torrent the caster already had is indistinguishable from one this route
// created - and Debrid-Link's remove never fails, it echoes back whatever id it
// was handed, so a wrong cleanup would silently delete a seedbox item the user
// put there on purpose. There is nothing to clean up either: the id is stable
// and the links survive removal.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { imdbid, hash } = req.query;
	const apiKey = readProviderKey(req, ['apiKey']);

	if (!apiKey || !hash) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "apiKey" or "hash" parameter',
		});
		return;
	}
	if (typeof imdbid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({ status: 'error', errorMessage: 'Invalid "imdbid" or "hash"' });
		return;
	}

	try {
		const release = await resolveDebridLinkRelease(apiKey, hash);

		if (!release.finished) {
			// Debrid-Link has no cheap "wait": the only poll is another request,
			// and a poll loop is what earns the hour-long lockout. The percent is
			// already in the add response, so this costs nothing extra.
			res.status(409).json({
				status: 'error',
				errorMessage: `Debrid-Link is still downloading this release (${release.percent}%) - cast it again once it finishes`,
			});
			return;
		}

		if (release.files.length === 0) {
			res.status(404).json({
				status: 'error',
				errorMessage: 'No video files in this release on Debrid-Link',
			});
			return;
		}

		// Largest first, so this is the feature rather than a trailer or an extra
		const feature = release.files[0];
		const userid = await generateDebridLinkUserId(apiKey);

		await db.saveDebridLinkCast(
			imdbid,
			userid,
			hash,
			feature.filename,
			Math.round(feature.size / 1024 / 1024),
			feature.path,
			// Stored as the play route's fallback for a viewer whose own
			// credential cannot resolve the hash. Never logged, never returned.
			feature.link ?? undefined
		);

		res.status(200).json({
			status: 'success',
			message: 'You can now stream the movie in Stremio',
			filename: feature.filename,
		});
	} catch (error) {
		const message = describeDebridLinkError(error);
		console.error('Failed to cast movie to Debrid-Link:', message);
		res.status(500).json({ status: 'error', errorMessage: message });
	}
}
