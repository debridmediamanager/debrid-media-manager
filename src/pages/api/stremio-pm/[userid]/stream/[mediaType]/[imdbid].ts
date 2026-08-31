import { checkPremiumizeCache } from '@/services/premiumize';
import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { getTroveCandidates } from '@/utils/cachedTroveStreams';
import {
	extractStreamMetadata,
	formatStremioStreamTitle,
	generateStreamName,
} from '@/utils/streamMetadata';
import { NextApiRequest, NextApiResponse } from 'next';

// lists all available streams for a movie or show (Premiumize version)
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
		profile = await db.getPremiumizeCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Premiumize profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Premiumize profile for user ${userid}` });
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
			name: 'DMM Cast PM✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
			behaviorHints: { bingeGroup: `dmm-pm:${imdbidStr}:cast` },
		});
	}

	try {
		const maxSize = typeSlug === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;
		const rawLimit = profile.otherStreamsLimit ?? 5;
		const otherStreamsLimit = Math.max(0, Math.min(5, rawLimit));

		const [userCastItems, otherItems, troveCandidates] = await Promise.all([
			db.getPremiumizeUserCastStreams(imdbidStr, userid, 5),
			db.getPremiumizeOtherStreams(
				imdbidStr,
				userid,
				otherStreamsLimit,
				maxSize > 0 ? maxSize : undefined
			),
			// The scraped pool behind the DMM detail page: every release for the
			// title, offered once Premiumize confirms the hash is cached. This is
			// the same probe the page runs to paint its green tokens.
			getTroveCandidates({
				mediaType: typeSlug === 'movie' ? 'movie' : 'series',
				imdbId: imdbidStr,
				maxSizeGb: maxSize > 0 ? maxSize : undefined,
			}),
		]);

		// Premiumize is the one provider that can answer "will this actually
		// play?" before offering it: `cache/check` is free, non-destructive and
		// batched, so a hash that has fallen out of the cache is dropped here
		// rather than handed over as a stream that errors on click.
		const candidates = [...userCastItems, ...otherItems];
		const offeredHashes = new Set(candidates.map((item) => item.hash.toLowerCase()));
		const troveCandidatesToProbe = troveCandidates.filter(
			(item) => !offeredHashes.has(item.hash.toLowerCase())
		);
		const uniqueHashes = Array.from(
			new Set([
				...candidates.map((item) => item.hash),
				...troveCandidatesToProbe.map((i) => i.hash),
			])
		);
		const cached = new Set<string>();
		let cacheProbeFailed = false;
		if (uniqueHashes.length > 0) {
			try {
				const results = await checkPremiumizeCache(profile.apiKey, uniqueHashes);
				for (const result of results) {
					if (result.cached) cached.add(result.hash.toLowerCase());
				}
			} catch (error) {
				// A failed probe must not empty the list - fall back to offering
				// every *cast* and let play report the truth. Trove releases get no
				// such pass: nobody chose them, so an unverified one is noise, not
				// a fallback.
				cacheProbeFailed = true;
				console.error(
					'[Stremio-PM Stream] Cache probe failed, offering casts unfiltered:',
					error instanceof Error ? error.message : 'Unknown error'
				);
				uniqueHashes.forEach((hash) => cached.add(hash.toLowerCase()));
			}
		}

		const isPlayable = (hash: string) => cached.has(hash.toLowerCase());
		const playableUserItems = userCastItems.filter((item) => isPlayable(item.hash));
		const playableOtherItems = otherItems.filter((item) => isPlayable(item.hash));
		const playableTrove = cacheProbeFailed
			? []
			: troveCandidatesToProbe.filter((item) => isPlayable(item.hash));

		const snapshots = await db.getSnapshotsByHashes(uniqueHashes);
		const snapshotMap = new Map(snapshots.map((s) => [s.hash, s]));

		console.log('[Stremio-PM Stream] Stream stats:', {
			totalStreams: playableUserItems.length + playableOtherItems.length,
			troveStreams: playableTrove.length,
			droppedUncached:
				candidates.length - (playableUserItems.length + playableOtherItems.length),
			uniqueHashes: uniqueHashes.length,
			snapshotsFound: snapshots.length,
		});

		const push = (
			item: (typeof playableUserItems)[number],
			isOwn: boolean,
			bingeGroup: string
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
					'PM'
				),
				url: `${process.env.DMM_ORIGIN}/api/stremio-pm/${userid}/play/${item.hash}?file=${encodeURIComponent(item.path ?? item.filename ?? '')}`,
				behaviorHints: { bingeGroup },
			} as any);
		};

		for (const item of playableUserItems) {
			push(item, true, `dmm-pm:${imdbidStr}:yours`);
		}
		for (let i = 0; i < playableOtherItems.length; i++) {
			push(playableOtherItems[i], false, `dmm-pm:${imdbidStr}:other:${i + 1}`);
		}
		// Cached scraped releases fill whatever the cast pool left open, in the
		// same "other streams" budget the size-limits setting describes. No
		// `?file=`: the play route resolves the release and picks the feature
		// file, exactly as it does for a cast row without a stored path.
		const troveSlots = Math.max(0, otherStreamsLimit - playableOtherItems.length);
		for (let i = 0; i < Math.min(troveSlots, playableTrove.length); i++) {
			const item = playableTrove[i];
			const snapshot = snapshotMap.get(item.hash);
			const metadata = snapshot ? extractStreamMetadata(snapshot.payload) : null;
			streams.push({
				name: generateStreamName(item.sizeMb, metadata),
				title: formatStremioStreamTitle(item.title, item.sizeMb, metadata, false, 'PM'),
				url: `${process.env.DMM_ORIGIN}/api/stremio-pm/${userid}/play/${item.hash}`,
				behaviorHints: { bingeGroup: `dmm-pm:${imdbidStr}:trove:${i + 1}` },
			} as any);
		}

		res.status(200).json({ streams, cacheMaxAge: 0 });
	} catch (error) {
		console.error(
			'Failed to get Premiumize casted URLs:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get Premiumize casted URLs' });
	}
}

export default withRateLimit(handler);
