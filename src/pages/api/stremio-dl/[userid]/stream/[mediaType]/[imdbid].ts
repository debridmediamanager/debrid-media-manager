import { resolveStreamTarget } from '@/services/anime/stremioAnime';
import { recordCastUse } from '@/services/castTelemetry';
import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { sendStreamError, sendStreamFailure } from '@/utils/castAddonResponses';
import { effectiveOtherStreamsLimit } from '@/utils/castOtherStreamsLimit';
import { debridLinkCachedTrove } from '@/utils/debridLinkCastApiHelpers';
import {
	audioLanguages,
	extractStreamMetadata,
	formatStremioStreamTitle,
	generateStreamName,
} from '@/utils/streamMetadata';
import { releaseBingeGroup } from '@/utils/stremioBingeGroup';
import { NextApiRequest, NextApiResponse } from 'next';

// lists all available streams for a movie or show (Debrid-Link version)
//
// Casts are offered as they are: no cast is filtered by a cache probe. Spare
// "other streams" slots are filled from DMM's scraped pool, like the TorBox,
// Premiumize and Offcloud routes do, with only releases Debrid-Link holds
// cached. Debrid-Link has no read-only cache check (`GET /seedbox/cached`
// answers `400 endpointDisabled`), so `debridLinkCachedTrove` probes with a
// bare-hash add from DMM's own account, never the viewer's, and removes what it
// added. A bare-hash miss is free (measured 2026-09-17), and the shared memo
// keeps repeat views from probing again.
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
	} catch (error) {
		sendStreamError(res, 'dl', error);
		return;
	}
	if (!profile) {
		// An install whose profile is gone: say so on the stream list, where
		// the member is looking, instead of a 500 on every title they open.
		sendStreamFailure(res, 'dl', 'not-connected');
		return;
	}
	recordCastUse('dl', userid, req.headers['user-agent']);

	const imdbidStr = imdbid.replace(/\.json$/, '');
	// An anime id (`kitsu:46474:5`) resolves to the AniDB key its casts are
	// filed under; an IMDb id keeps its own.
	const target = await resolveStreamTarget(imdbidStr, mediaType, process.env.DMM_ORIGIN);
	if (!target) {
		res.status(200).json({ streams: [], cacheMaxAge: 0 });
		return;
	}
	const { castKey, typeSlug, externalUrl } = target;

	const streams: any[] = [];

	if (!profile.hideCastOption) {
		streams.push({
			name: 'DMM Cast DL ✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
			behaviorHints: { bingeGroup: `dmm-dl:${imdbidStr}:cast` },
		});
	}

	try {
		const maxSize = typeSlug === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;
		// Above 5 only while the sponsorship that saved it is still active.
		const otherStreamsLimit = await effectiveOtherStreamsLimit(
			'dl',
			userid,
			profile.otherStreamsLimit
		);

		const [userCastItems, otherItems, troveCandidates] = await Promise.all([
			db.getDebridLinkUserCastStreams(castKey, userid, 5),
			db.getDebridLinkOtherStreams(
				castKey,
				userid,
				otherStreamsLimit,
				maxSize > 0 ? maxSize : undefined
			),
			target.trove(maxSize > 0 ? maxSize : undefined),
		]);

		const offeredHashes = new Set(
			[...userCastItems, ...otherItems].map((item) => item.hash.toLowerCase())
		);
		// A probe hiccup costs the trove streams, never the casts.
		const playableTrove = await debridLinkCachedTrove(
			troveCandidates.filter((item) => !offeredHashes.has(item.hash.toLowerCase())),
			Math.max(0, otherStreamsLimit - otherItems.length)
		).catch((error) => {
			console.error(
				'[Stremio-DL Stream] Trove cache probe failed, skipping trove streams:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			return [];
		});

		const uniqueHashes = Array.from(
			new Set([...userCastItems, ...otherItems, ...playableTrove].map((item) => item.hash))
		);
		const snapshots = await db.getSnapshotsByHashes(uniqueHashes);
		const snapshotMap = new Map(snapshots.map((s) => [s.hash, s]));

		console.log('[Stremio-DL Stream] Stream stats:', {
			totalStreams: userCastItems.length + otherItems.length,
			troveStreams: playableTrove.length,
			uniqueHashes: uniqueHashes.length,
			snapshotsFound: snapshots.length,
		});

		const push = (
			item: (typeof userCastItems)[number],
			isOwn: boolean,
			bingeGroup: string | undefined
		) => {
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
				behaviorHints: { bingeGroup, audioLanguages: audioLanguages(metadata) },
			} as any);
		};

		for (const item of userCastItems) {
			push(item, true, releaseBingeGroup('dmm-dl', item.hash));
		}
		for (let i = 0; i < otherItems.length; i++) {
			push(otherItems[i], false, releaseBingeGroup('dmm-dl', otherItems[i].hash));
		}
		// No `?file=`: the play route adds the cached torrent to the viewer's
		// account and plays its biggest file - the feature for a movie, the episode
		// for a single-episode release.
		for (const item of playableTrove) {
			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			streams.push({
				name: generateStreamName(item.sizeMb, metadata),
				title: formatStremioStreamTitle(item.title, item.sizeMb, metadata, false, 'DL'),
				url: `${process.env.DMM_ORIGIN}/api/stremio-dl/${userid}/play/${item.hash}`,
				behaviorHints: {
					bingeGroup: releaseBingeGroup('dmm-dl', item.hash),
					audioLanguages: audioLanguages(metadata),
				},
			} as any);
		}

		res.status(200).json({ streams, cacheMaxAge: 0 });
	} catch (error) {
		sendStreamError(res, 'dl', error);
		return;
	}
}

export default withRateLimit(handler);
