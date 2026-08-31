import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { SPONSOR_MAX_OTHER_STREAMS_LIMIT } from '@/utils/sponsorLimits';
import {
	extractStreamMetadata,
	formatStremioStreamTitle,
	generateStreamName,
} from '@/utils/streamMetadata';
import { NextApiRequest, NextApiResponse } from 'next';

// lists all available streams for a movie or show (AllDebrid version)
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

	let profile;
	try {
		profile = await db.getAllDebridCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get AllDebrid profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get AllDebrid profile for user ${userid}` });
		return;
	}

	const imdbidStr = (imdbid as string).replace(/\.json$/, '');
	const typeSlug = mediaType === 'movie' ? 'movie' : 'show';
	let externalUrl = `${process.env.DMM_ORIGIN}/${typeSlug}/${imdbidStr}`;
	if (typeSlug === 'show') {
		// imdbidStr = imdbid:season:episode
		// externalUrl should be /show/imdbid/season
		const [imdbid2, season] = imdbidStr.split(':');
		externalUrl = `${process.env.DMM_ORIGIN}/${typeSlug}/${imdbid2}/${season}`;
	}

	const streams: any[] = [];

	// Add cast option unless hidden in profile settings
	if (!profile.hideCastOption) {
		streams.push({
			name: 'DMM Cast AD✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
			behaviorHints: {
				bingeGroup: `dmm-ad:${imdbidStr}:cast`,
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
			db.getAllDebridUserCastStreams(imdbidStr, userid, 5),
			db.getAllDebridOtherStreams(
				imdbidStr,
				userid,
				otherStreamsLimit,
				maxSize > 0 ? maxSize : undefined
			),
		]);

		const allHashes = [
			...userCastItems.map((item) => item.hash),
			...otherItems.map((item) => item.hash),
		];
		const uniqueHashes = Array.from(new Set(allHashes));

		const snapshots = await db.getSnapshotsByHashes(uniqueHashes);
		const snapshotMap = new Map(snapshots.map((s) => [s.hash, s]));

		console.log('[Stremio-AD Stream] Metadata enrichment stats:', {
			totalStreams: userCastItems.length + otherItems.length,
			uniqueHashes: uniqueHashes.length,
			snapshotsFound: snapshots.length,
			hitRate:
				uniqueHashes.length > 0
					? `${((snapshots.length / uniqueHashes.length) * 100).toFixed(1)}%`
					: 'N/A',
		});

		for (const item of userCastItems) {
			// Skip items without magnetId/fileIndex (should not happen for AllDebrid)
			if (item.magnetId == null || item.fileIndex == null) {
				continue;
			}

			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			const title = formatStremioStreamTitle(
				item.filename ?? 'Unknown Title',
				item.size,
				metadata,
				true,
				'AD' // AllDebrid suffix
			);
			const name = generateStreamName(item.size, metadata);

			streams.push({
				name,
				title,
				url: `${process.env.DMM_ORIGIN}/api/stremio-ad/${userid}/play/${item.magnetId}:${item.fileIndex}`,
				behaviorHints: {
					bingeGroup: `dmm-ad:${imdbidStr}:yours`,
				},
			} as any);
		}

		for (let i = 0; i < otherItems.length; i++) {
			const item = otherItems[i];

			// Skip items without magnetId/fileIndex (should not happen for AllDebrid)
			if (item.magnetId == null || item.fileIndex == null) {
				continue;
			}

			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			const title = formatStremioStreamTitle(
				item.filename ?? 'Unknown Title',
				item.size,
				metadata,
				false,
				'AD' // AllDebrid suffix
			);
			const name = generateStreamName(item.size, metadata);

			streams.push({
				name,
				title,
				url: `${process.env.DMM_ORIGIN}/api/stremio-ad/${userid}/play/${item.magnetId}:${item.fileIndex}`,
				behaviorHints: {
					bingeGroup: `dmm-ad:${imdbidStr}:other:${i + 1}`,
				},
			} as any);
		}

		res.status(200).json({
			streams,
			cacheMaxAge: 0,
		});
	} catch (error) {
		console.error(
			'Failed to get AllDebrid casted URLs:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get AllDebrid casted URLs' });
		return;
	}
}

export default withRateLimit(handler);
