import { resolveStreamTarget } from '@/services/anime/stremioAnime';
import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { sendStreamError, sendStreamFailure } from '@/utils/castAddonResponses';
import { isLegacyToken } from '@/utils/castApiHelpers';
import { rdCastPlayId } from '@/utils/rdCastLink';
import { isRdBlockedFilename } from '@/utils/rdFilenameFilter';
import { SPONSOR_MAX_OTHER_STREAMS_LIMIT } from '@/utils/sponsorLimits';
import {
	extractStreamMetadata,
	formatStremioStreamTitle,
	generateStreamName,
} from '@/utils/streamMetadata';
import { releaseBingeGroup } from '@/utils/stremioBingeGroup';
import { NextApiRequest, NextApiResponse } from 'next';

// lists all available streams for a movie or show
// note, addon prefix is /api/stremio/${userid}
async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { userid, mediaType, imdbid } = req.query;

	if (typeof userid !== 'string' || typeof imdbid !== 'string' || typeof mediaType !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid", "imdbid" or "mediaType" query parameter',
		});
		return;
	}

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	// Check for legacy 5-character token
	if (isLegacyToken(userid)) {
		res.status(200).json({
			streams: [
				{
					name: '⚠️ Update Required',
					title: 'DMM Cast RD security update required\n\n1. Visit https://debridmediamanager.com/stremio\n2. Reinstall the addon\n3. Your casted content will be preserved',
					externalUrl: 'https://debridmediamanager.com/stremio',
				},
			],
			cacheMaxAge: 0,
		});
		return;
	}

	let profile;
	try {
		profile = await db.getCastProfile(userid);
	} catch (error) {
		sendStreamError(res, 'rd', error);
		return;
	}
	if (!profile) {
		// An install whose profile is gone: say so on the stream list, where
		// the member is looking, instead of a 500 on every title they open.
		sendStreamFailure(res, 'rd', 'not-connected');
		return;
	}

	const imdbidStr = (imdbid as string).replace(/\.json$/, '');
	// An anime id (`kitsu:46474:5`) resolves to the AniDB key its casts are
	// filed under; an IMDb id keeps its own.
	const target = await resolveStreamTarget(imdbidStr, mediaType, process.env.DMM_ORIGIN);
	if (!target) {
		res.status(200).json({ streams: [], cacheMaxAge: 0 });
		return;
	}
	const { castKey, typeSlug, externalUrl } = target;

	const streams: any[] = [];

	// Add cast option unless hidden in profile settings
	if (!profile.hideCastOption) {
		streams.push({
			name: 'DMM Cast RD✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
			behaviorHints: {
				bingeGroup: `dmm:${imdbidStr}:cast`,
			},
		});
	}

	try {
		const maxSize = typeSlug === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;
		const rawLimit = profile.otherStreamsLimit ?? 5;
		// The ceiling is the sponsor one because only a verified sponsor could
		// have stored a value above the standard limit - Stremio calls this
		// endpoint with nothing but the userid, so there is no token to check here.
		const otherStreamsLimit = Math.max(0, Math.min(SPONSOR_MAX_OTHER_STREAMS_LIMIT, rawLimit));

		// get urls from db
		const [userCastItems, otherItems] = await Promise.all([
			db.getUserCastStreams(castKey, userid, 5),
			db.getOtherStreams(
				castKey,
				userid,
				otherStreamsLimit,
				maxSize > 0 ? maxSize : undefined
			),
		]);

		// A stream is played by unrestricting its Real-Debrid link, so a row
		// without one - a `debridio:{hash}` availability marker - has nothing to
		// offer, and cutting it at character 26 made a play URL out of a slice of
		// the infohash. Its `url` is no fallback: on a marker row it is the marker.
		const playable = (item: { filename: string; link: string | null }) =>
			!isRdBlockedFilename(item.filename) && rdCastPlayId(item.link) !== null;
		const playUrl = (link: string) =>
			`${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${rdCastPlayId(link)}`;

		const filteredUserCastItems = userCastItems.filter(playable);
		const filteredOtherItems = otherItems.filter(playable);

		const allHashes = [
			...filteredUserCastItems.map((item) => item.hash),
			...filteredOtherItems.map((item) => item.hash),
		];
		const uniqueHashes = Array.from(new Set(allHashes));

		const snapshots = await db.getSnapshotsByHashes(uniqueHashes);
		const snapshotMap = new Map(snapshots.map((s) => [s.hash, s]));

		console.log('[Stremio Stream] Metadata enrichment stats:', {
			totalStreams: filteredUserCastItems.length + filteredOtherItems.length,
			uniqueHashes: uniqueHashes.length,
			snapshotsFound: snapshots.length,
			hitRate:
				uniqueHashes.length > 0
					? `${((snapshots.length / uniqueHashes.length) * 100).toFixed(1)}%`
					: 'N/A',
		});

		for (const item of filteredUserCastItems) {
			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			const title = formatStremioStreamTitle(
				item.filename ?? 'Unknown Title',
				item.size,
				metadata,
				true
			);
			const name = generateStreamName(item.size, metadata);

			streams.push({
				name,
				title,
				url: playUrl(item.link),
				behaviorHints: {
					bingeGroup: releaseBingeGroup('dmm', item.hash),
				},
			} as any);
		}

		for (let i = 0; i < filteredOtherItems.length; i++) {
			const item = filteredOtherItems[i];
			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			const title = formatStremioStreamTitle(
				item.filename ?? 'Unknown Title',
				item.size,
				metadata,
				false
			);
			const name = generateStreamName(item.size, metadata);

			streams.push({
				name,
				title,
				url: playUrl(item.link),
				behaviorHints: {
					bingeGroup: releaseBingeGroup('dmm', item.hash),
				},
			} as any);
		}

		res.status(200).json({
			streams,
			cacheMaxAge: 0,
		});
	} catch (error) {
		sendStreamError(res, 'rd', error);
		return;
	}
}

export default withRateLimit(handler);
