import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { isLegacyToken } from '@/utils/castApiHelpers';
import { isRdBlockedFilename } from '@/utils/rdFilenameFilter';
import {
	extractStreamMetadata,
	formatStremioStreamTitle,
	generateStreamName,
} from '@/utils/streamMetadata';
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
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Real-Debrid profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Real-Debrid profile for user ${userid}` });
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
		const otherStreamsLimit = Math.max(0, Math.min(5, rawLimit));

		// get urls from db
		const [userCastItems, otherItems] = await Promise.all([
			db.getUserCastStreams(imdbidStr, userid, 5),
			db.getOtherStreams(
				imdbidStr,
				userid,
				otherStreamsLimit,
				maxSize > 0 ? maxSize : undefined
			),
		]);

		const filteredUserCastItems = userCastItems.filter(
			(item) => !isRdBlockedFilename(item.filename)
		);
		const filteredOtherItems = otherItems.filter((item) => !isRdBlockedFilename(item.filename));

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
			hitRate: `${((snapshots.length / uniqueHashes.length) * 100).toFixed(1)}%`,
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
				url: item.link
					? `${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${item.link.substring(26)}`
					: item.url,
				behaviorHints: {
					bingeGroup: `dmm:${imdbidStr}:yours`,
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
				url: item.link
					? `${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${item.link.substring(26)}`
					: item.url,
				behaviorHints: {
					bingeGroup: `dmm:${imdbidStr}:other:${i + 1}`,
				},
			} as any);
		}

		res.status(200).json({
			streams,
			cacheMaxAge: 0,
		});
	} catch (error) {
		console.error(
			'Failed to get casted URLs:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get casted URLs' });
		return;
	}
}

export default withRateLimit(handler);
