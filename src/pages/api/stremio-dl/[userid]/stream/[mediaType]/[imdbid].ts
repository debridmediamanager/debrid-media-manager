import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { SPONSOR_MAX_OTHER_STREAMS_LIMIT } from '@/utils/sponsorLimits';
import {
	extractStreamMetadata,
	formatStremioStreamTitle,
	generateStreamName,
} from '@/utils/streamMetadata';
import { NextApiRequest, NextApiResponse } from 'next';

// lists all available streams for a movie or show (Debrid-Link version)
//
// Two things this route deliberately does not do, both for the same reason:
// **Debrid-Link publishes no cache probe.** `GET /seedbox/cached` answers
// `400 endpointDisabled` for every parameter shape and nothing replaced it, so
// the only way to ask "is this playable" is a mutating add that costs one of
// the viewer's 50 daily torrents.
//
//  - No cast is filtered out here. Offcloud drops a hash its `/api/cache` probe
//    no longer holds; there is no equivalent, and a per-stream probe would spend
//    the viewer's whole daily quota on building a stream list.
//  - **No scraped-trove releases are offered.** The TorBox, Premiumize and
//    Offcloud routes fill spare stream slots from DMM's scraped pool because
//    each of them can verify a hash for free first. Offering unverified releases
//    here would mean the viewer's player spends a daily torrent per click to
//    find out, so the list stays exactly what somebody chose to cast.
//
// TODO: a transcoded variant per cast. `POST /stream/transcode/add` with a file
// id answers in about 800 ms with a live HLS playlist
// (`https://stream1.debrid.link/stream/<uuid>/playlist.m3u8`) at 1080p plus an
// audio rendition, and the playlist is keyless like everything else here.
// Debrid-Link is the only provider in this stack that transcodes at all, so a
// second stream row - "Transcoded" beside the direct file - would make an
// unplayable codec playable on a client that cannot handle the original. It
// needs a file id, which means the play-time resolve rather than the stored
// row, so it is a separate route rather than an extra field here.
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
		profile = await db.getDebridLinkCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Debrid-Link profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Debrid-Link profile for user ${userid}` });
		return;
	}

	const imdbidStr = imdbid.replace(/\.json$/, '');
	const typeSlug = mediaType === 'movie' ? 'movie' : 'show';
	let externalUrl = `${process.env.DMM_ORIGIN}/${typeSlug}/${imdbidStr}`;
	if (typeSlug === 'show') {
		// imdbidStr = imdbid:season:episode, and the page is /show/imdbid/season
		const [imdbid2, season] = imdbidStr.split(':');
		externalUrl = `${process.env.DMM_ORIGIN}/${typeSlug}/${imdbid2}/${season}`;
	}

	const streams: any[] = [];

	if (!profile.hideCastOption) {
		streams.push({
			name: 'DMM Cast DL✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
			behaviorHints: { bingeGroup: `dmm-dl:${imdbidStr}:cast` },
		});
	}

	try {
		const maxSize = typeSlug === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;
		const rawLimit = profile.otherStreamsLimit ?? 5;
		// The ceiling is the sponsor one because only a verified sponsor could
		// have stored a value above the standard limit - Stremio calls this
		// endpoint with nothing but the userid, so there is no token to check here.
		const otherStreamsLimit = Math.max(0, Math.min(SPONSOR_MAX_OTHER_STREAMS_LIMIT, rawLimit));

		const [userCastItems, otherItems] = await Promise.all([
			db.getDebridLinkUserCastStreams(imdbidStr, userid, 5),
			db.getDebridLinkOtherStreams(
				imdbidStr,
				userid,
				otherStreamsLimit,
				maxSize > 0 ? maxSize : undefined
			),
		]);

		const uniqueHashes = Array.from(
			new Set([...userCastItems, ...otherItems].map((item) => item.hash))
		);
		const snapshots = await db.getSnapshotsByHashes(uniqueHashes);
		const snapshotMap = new Map(snapshots.map((s) => [s.hash, s]));

		console.log('[Stremio-DL Stream] Stream stats:', {
			totalStreams: userCastItems.length + otherItems.length,
			uniqueHashes: uniqueHashes.length,
			snapshotsFound: snapshots.length,
		});

		const push = (item: (typeof userCastItems)[number], isOwn: boolean, bingeGroup: string) => {
			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			streams.push({
				name: generateStreamName(item.size, metadata),
				title: formatStremioStreamTitle(
					item.filename ?? 'Unknown Title',
					item.size,
					metadata,
					isOwn,
					'DL'
				),
				// The hash and the stored path, never a link. A Debrid-Link URL is
				// a permanent unauthenticated capability, and a stream list is
				// exactly the sort of thing a client caches.
				url: `${process.env.DMM_ORIGIN}/api/stremio-dl/${userid}/play/${item.hash}?file=${encodeURIComponent(item.path ?? item.filename ?? '')}`,
				behaviorHints: { bingeGroup },
			} as any);
		};

		for (const item of userCastItems) {
			push(item, true, `dmm-dl:${imdbidStr}:yours`);
		}
		for (let i = 0; i < otherItems.length; i++) {
			push(otherItems[i], false, `dmm-dl:${imdbidStr}:other:${i + 1}`);
		}

		res.status(200).json({ streams, cacheMaxAge: 0 });
	} catch (error) {
		console.error(
			'Failed to get Debrid-Link casted URLs:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get Debrid-Link casted URLs' });
	}
}

export default withRateLimit(handler);
