import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import {
	extractStreamMetadata,
	formatStremioStreamTitle,
	generateStreamName,
} from '@/utils/streamMetadata';
import { NextApiRequest, NextApiResponse } from 'next';

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
		profile = await db.getTorrinCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Torrin profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Torrin profile for user ${userid}` });
		return;
	}

	const imdbidStr = imdbid.replace(/\.json$/, '');
	const typeSlug = mediaType === 'movie' ? 'movie' : 'show';
	let externalUrl = `${process.env.DMM_ORIGIN}/${typeSlug}/${imdbidStr}`;
	if (typeSlug === 'show') {
		const [imdbid2, season] = imdbidStr.split(':');
		externalUrl = `${process.env.DMM_ORIGIN}/${typeSlug}/${imdbid2}/${season}`;
	}

	const streams: any[] = [];

	if (!profile.hideCastOption) {
		streams.push({
			name: 'DMM Cast TR✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
			behaviorHints: {
				bingeGroup: `dmm-tr:${imdbidStr}:cast`,
			},
		});
	}

	try {
		const maxSize = typeSlug === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;
		const rawLimit = profile.otherStreamsLimit ?? 5;
		const otherStreamsLimit = Math.max(0, Math.min(5, rawLimit));

		const [userCastItems, otherItems] = await Promise.all([
			db.getTorrinUserCastStreams(imdbidStr, userid, 5),
			db.getTorrinOtherStreams(
				imdbidStr,
				userid,
				profile.baseUrl,
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

		for (const item of userCastItems) {
			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			const title = formatStremioStreamTitle(
				item.filename ?? 'Unknown Title',
				item.size,
				metadata,
				true,
				'TR'
			);
			const name = generateStreamName(item.size, metadata);
			const playUrl = `${process.env.DMM_ORIGIN}/api/stremio-tr/${userid}/play/${encodeURIComponent(item.link)}`;

			streams.push({
				name,
				title,
				url: playUrl,
				behaviorHints: {
					bingeGroup: `dmm-tr:${imdbidStr}:yours`,
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
				'TR'
			);
			const name = generateStreamName(item.size, metadata);
			const playUrl = `${process.env.DMM_ORIGIN}/api/stremio-tr/${userid}/play/${encodeURIComponent(item.link)}`;

			streams.push({
				name,
				title,
				url: playUrl,
				behaviorHints: {
					bingeGroup: `dmm-tr:${imdbidStr}:other:${i + 1}`,
				},
			} as any);
		}

		res.status(200).json({
			streams,
			cacheMaxAge: 0,
		});
	} catch (error) {
		console.error(
			'Failed to get Torrin casted URLs:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get Torrin casted URLs' });
		return;
	}
}

export default withRateLimit(handler);
