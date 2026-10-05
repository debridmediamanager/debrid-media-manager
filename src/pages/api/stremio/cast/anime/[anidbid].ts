import { canonicalAnimeCastId } from '@/services/anime/stremioAnimeIds';
import { repository as db } from '@/services/repository';
import { extractToken, generateUserId } from '@/utils/castApiHelpers';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { RdAddPausedError } from '@/utils/rdAddPause';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { anidbid, hash, fileIds } = req.query;
	const token = extractToken(req);
	if (!token || !hash || !fileIds) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" parameter',
		});
		return;
	}
	if (
		typeof anidbid !== 'string' ||
		typeof hash !== 'string' ||
		(!Array.isArray(fileIds) && typeof fileIds !== 'string')
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "token", "hash" or "fileIds" parameter',
		});
		return;
	}
	const ipAddress = getClientIpFromRequest(req);
	const errorEpisodes: string[] = [];

	const fileIdsArr = Array.isArray(fileIds) ? fileIds : [fileIds];

	const userid = await generateUserId(token);

	// Set when Real-Debrid refused an add twice, a pause apart. Every file here
	// is the same torrent added again, so the rest would only be refused too:
	// they are reported unsent with the reason instead of each waiting out a
	// pause of its own.
	let pausedMessage: string | undefined;
	for (const [index, fileId] of fileIdsArr.entries()) {
		try {
			const [streamUrl, rdLink, seasonNumber, episodeNumber, fileSize] = await getStreamUrl(
				token,
				hash,
				parseInt(fileId, 10),
				ipAddress,
				'anime'
			);

			// Fansub releases number episodes absolutely (`Show - 05`,
			// `One Piece - 1100`) and name no season. AniDB gives every season
			// its own entry and numbers that entry's episodes from 1, so an
			// episode with no season is season 1 of the entry this is keyed by.
			const season = seasonNumber >= 0 ? seasonNumber : episodeNumber >= 0 ? 1 : -1;

			// See the same guard in cast/series: the bare id is the movie key, so
			// an unparsed episode overwrites whatever was cast before it.
			if (streamUrl && season >= 0 && episodeNumber >= 0) {
				// The Stremio stream routes look an anime episode up as
				// `anidb-<aid>:<season>:<episode>`, however the page spelled the id.
				const castKey = `${canonicalAnimeCastId(anidbid)}:${season}:${episodeNumber}`;
				await db.saveCast(castKey, userid, hash, streamUrl, rdLink, fileSize);
			} else if (streamUrl) {
				errorEpisodes.push(`fileId:${fileId} (no episode number in filename)`);
			} else if (season >= 0 && episodeNumber >= 0) {
				errorEpisodes.push(`S${season}E${episodeNumber}`);
			} else {
				errorEpisodes.push(`fileId:${fileId}`);
			}
		} catch (e) {
			if (e instanceof RdAddPausedError) {
				pausedMessage = e.message;
				errorEpisodes.push(...fileIdsArr.slice(index).map((id) => `fileId:${id}`));
				break;
			}
			console.error(e);
			errorEpisodes.push(`fileId:${fileId}`);
		}
	}

	res.status(200).json({
		errorEpisodes,
		...(pausedMessage ? { errorMessage: pausedMessage } : {}),
	});
}
