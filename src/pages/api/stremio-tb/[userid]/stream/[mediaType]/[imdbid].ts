import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import {
	extractStreamMetadata,
	formatStremioStreamTitle,
	generateStreamName,
} from '@/utils/streamMetadata';
import { isWebDownloadHash } from '@/utils/torboxWebDownload';
import { NextApiRequest, NextApiResponse } from 'next';

// A TorBox torrent id only resolves inside the account that created it -
// `requestdl` answers 500 DATABASE_ERROR for anyone else (verified 2026-08-24 on
// three real rows). Marking the caster's own rows lets the play route skip a
// direct lookup that cannot succeed and go straight to the hash, which re-adds
// the (still cached) torrent to the viewer's own account.
const buildPlayUrl = (
	userid: string,
	item: {
		hash: string;
		filename?: string | null;
		torrentId: number | null;
		fileId: number | null;
	},
	isOwnCast: boolean
) => {
	const encodedFilename = encodeURIComponent(item.filename ?? '');
	if (item.torrentId != null && item.fileId != null) {
		// hash + filename ride along as the fallback for a torrent the caster has
		// since deleted from TorBox.
		return `${process.env.DMM_ORIGIN}/api/stremio-tb/${userid}/play/${item.torrentId}:${item.fileId}?h=${item.hash}&file=${encodedFilename}${isOwnCast ? '&own=1' : ''}`;
	}
	// Legacy rows: use the hash with the filename to match the correct file
	return `${process.env.DMM_ORIGIN}/api/stremio-tb/${userid}/play/${item.hash}?file=${encodedFilename}`;
};

// lists all available streams for a movie or show (TorBox version)
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
		profile = await db.getTorBoxCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get TorBox profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get TorBox profile for user ${userid}` });
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
			name: 'DMM Cast TB✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
			behaviorHints: {
				bingeGroup: `dmm-tb:${imdbidStr}:cast`,
			},
		});
	}

	try {
		const maxSize = typeSlug === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;
		const rawLimit = profile.otherStreamsLimit ?? 5;
		const otherStreamsLimit = Math.max(0, Math.min(5, rawLimit));

		// get urls from db
		const [userCastItems, allOtherItems] = await Promise.all([
			db.getTorBoxUserCastStreams(imdbidStr, userid, 5),
			db.getTorBoxOtherStreams(
				imdbidStr,
				userid,
				otherStreamsLimit,
				maxSize > 0 ? maxSize : undefined
			),
		]);

		// Another user's web download can't be resolved with this user's key —
		// it only exists inside the account that created it — so it is dropped
		// rather than offered as a stream that would 500 on play.
		const otherItems = allOtherItems.filter((item) => !isWebDownloadHash(item.hash));

		const allHashes = [
			...userCastItems.map((item) => item.hash),
			...otherItems.map((item) => item.hash),
		];
		const uniqueHashes = Array.from(new Set(allHashes));

		const snapshots = await db.getSnapshotsByHashes(uniqueHashes);
		const snapshotMap = new Map(snapshots.map((s) => [s.hash, s]));

		console.log('[Stremio-TB Stream] Metadata enrichment stats:', {
			totalStreams: userCastItems.length + otherItems.length,
			uniqueHashes: uniqueHashes.length,
			snapshotsFound: snapshots.length,
			hitRate:
				uniqueHashes.length > 0
					? `${((snapshots.length / uniqueHashes.length) * 100).toFixed(1)}%`
					: 'N/A',
		});

		for (const item of userCastItems) {
			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			const title = formatStremioStreamTitle(
				item.filename ?? 'Unknown Title',
				item.size,
				metadata,
				true,
				'TB' // TorBox suffix
			);
			const name = generateStreamName(item.size, metadata);

			// Build play URL with fallback parameters for when torrent IDs become stale
			streams.push({
				name,
				title,
				url: buildPlayUrl(userid, item, true),
				behaviorHints: {
					bingeGroup: `dmm-tb:${imdbidStr}:yours`,
				},
			} as any);
		}

		for (let i = 0; i < otherItems.length; i++) {
			const item = otherItems[i];
			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			const title = formatStremioStreamTitle(
				item.filename ?? 'Unknown Title',
				item.size,
				metadata,
				false,
				'TB' // TorBox suffix
			);
			const name = generateStreamName(item.size, metadata);

			// Build play URL with fallback parameters for when torrent IDs become stale
			streams.push({
				name,
				title,
				url: buildPlayUrl(userid, item, false),
				behaviorHints: {
					bingeGroup: `dmm-tb:${imdbidStr}:other:${i + 1}`,
				},
			} as any);
		}

		res.status(200).json({
			streams,
			cacheMaxAge: 0,
		});
	} catch (error) {
		console.error(
			'Failed to get TorBox casted URLs:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get TorBox casted URLs' });
		return;
	}
}

export default withRateLimit(handler);
