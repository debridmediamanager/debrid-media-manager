import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { readBearerKey, refuseQueryKey } from '@/utils/providerKeyHeader';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { NextApiRequest, NextApiResponse } from 'next';

// cast: unrestricts one selected file and saves it to the database. Called by
// the per-file Cast button in the info window (showInfo/castFile.ts), which
// sends the Real-Debrid key as a bearer token and follows `redirectUrl`.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store');

	// That button used to be a GET form with the key as `?token=`, which wrote
	// it into dmm-01's access log, the new tab's history and the Referer of the
	// tab's favicon request. Nothing else ever called this route, so a key in
	// the URL is refused rather than honoured.
	if (refuseQueryKey(req, res, ['token'])) return;

	const { imdbid, hash, fileId, mediaType } = req.query;
	const token = readBearerKey(req);
	if (!token) {
		res.status(401).json({
			status: 'error',
			errorMessage: 'Missing Real-Debrid key in the Authorization header',
		});
		return;
	}
	if (!hash || !fileId || !mediaType) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "hash", "fileId" or "mediaType" parameter',
		});
		return;
	}
	if (
		typeof imdbid !== 'string' ||
		typeof hash !== 'string' ||
		typeof fileId !== 'string' ||
		typeof mediaType !== 'string'
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "hash", "fileId" or "mediaType" parameter',
		});
		return;
	}
	try {
		const ipAddress = getClientIpFromRequest(req);
		const [streamUrl, rdLink, seasonNumber, episodeNumber, fileSize] = await getStreamUrl(
			token,
			hash,
			parseInt(fileId, 10),
			ipAddress,
			mediaType
		);

		if (streamUrl && mediaType !== 'movie' && (seasonNumber < 0 || episodeNumber < 0)) {
			// The bare imdb id is the movie key. Writing an episode there would
			// overwrite whatever else this torrent already cast under it.
			res.status(422).json({
				status: 'error',
				errorMessage: 'Could not read a season and episode from the filename',
			});
			return;
		}

		if (streamUrl) {
			let redirectUrl = getStremioDetailUrl(imdbid);
			let message = 'You can now stream the movie in Stremio';
			if (seasonNumber >= 0 && episodeNumber >= 0) {
				redirectUrl = getStremioDetailUrl(imdbid, {
					season: seasonNumber,
					episode: episodeNumber,
				});
				message = `You can now stream S${seasonNumber}E${episodeNumber} in Stremio`;
			}

			const castKey = `${imdbid}${
				seasonNumber >= 0 && episodeNumber >= 0 ? `:${seasonNumber}:${episodeNumber}` : ''
			}`;

			const userid = await generateUserId(token);

			await db.saveCast(castKey, userid, hash, streamUrl, rdLink, fileSize);

			res.status(200).json({ status: 'success', redirectUrl, message });
			return;
		}

		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to cast, no streamUrl',
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({
			status: 'error',
			errorMessage: `Failed to cast: ${error}`,
		});
	}
}
