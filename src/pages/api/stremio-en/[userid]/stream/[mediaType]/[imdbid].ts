import { resolveStreamTarget } from '@/services/anime/stremioAnime';
import { recordCastUse } from '@/services/castTelemetry';
import { EasynewsAuthError, splitEasynewsPath, type EasynewsResult } from '@/services/easynews';
import { withRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { settleWithin } from '@/utils/castAddonFailure';
import { sendStreamError, sendStreamFailure } from '@/utils/castAddonResponses';
import { effectiveOtherStreamsLimit } from '@/utils/castOtherStreamsLimit';
import { easynewsCredentialsOf } from '@/utils/easynewsCastKey';
import {
	easynewsReleaseOf,
	easynewsStreamResults,
	goneEasynewsPaths,
} from '@/utils/easynewsCastSearch';
import { formatStremioStreamTitle, generateStreamName } from '@/utils/streamMetadata';
import { releaseBingeGroup } from '@/utils/stremioBingeGroup';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

// Stremio waits about 15 s for an addon; a slow search must not cost the casts.
const SEARCH_BUDGET_MS = 10_000;
// The dead-file check runs after the search, inside the same ~15 s.
const PROBE_BUDGET_MS = 4_000;
// Search hits checked beyond the open slots, so a dead one leaves no gap.
const SPARE_HITS = 3;

const hashOf = (path: string) => path.slice(0, path.indexOf('.'));

// lists all available streams for a movie or show (Easynews version): the
// member's casts, then other members' casts, then what the member's own Easynews
// search finds for the title, as the DMM page's Easynews rows list it.
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
		profile = await db.getEasynewsCastProfile(userid);
	} catch (error) {
		sendStreamError(res, 'en', error);
		return;
	}
	if (!profile) {
		sendStreamFailure(res, 'en', 'not-connected');
		return;
	}
	const credentials = easynewsCredentialsOf(profile.apiKey);
	if (!credentials) {
		sendStreamFailure(res, 'en', 'credential');
		return;
	}
	recordCastUse('en', userid, req.headers['user-agent']);

	const imdbidStr = imdbid.replace(/\.json$/, '');
	const target = await resolveStreamTarget(imdbidStr, mediaType, process.env.DMM_ORIGIN);
	if (!target) {
		res.status(200).json({ streams: [], cacheMaxAge: 0 });
		return;
	}
	const { castKey, typeSlug } = target;
	// Easynews rows and their Cast button live on the Usenet tab of a title page.
	const externalUrl = /\/(movie|show)\//.test(target.externalUrl)
		? `${target.externalUrl}/usenet`
		: target.externalUrl;

	const streams: any[] = [];

	if (!profile.hideCastOption) {
		streams.push({
			name: 'DMM Cast EN ✨',
			title: 'Cast a file from Easynews',
			externalUrl,
			behaviorHints: { bingeGroup: `dmm-en:${imdbidStr}:cast` },
		});
	}

	try {
		const maxSize = typeSlug === 'movie' ? profile.movieMaxSize : profile.episodeMaxSize;
		// Above 5 only while the sponsorship that saved it is still active.
		const otherStreamsLimit = await effectiveOtherStreamsLimit(
			'en',
			userid,
			profile.otherStreamsLimit
		);

		const [userCastItems, otherItems, search] = await Promise.all([
			db.getEasynewsUserCastStreams(castKey, userid, 5),
			db.getEasynewsOtherStreams(
				castKey,
				userid,
				otherStreamsLimit,
				maxSize > 0 ? maxSize : undefined
			),
			otherStreamsLimit > 0
				? settleWithin(
						easynewsStreamResults(credentials, castKey, maxSize).then(
							(results) => ({ results }),
							(error: unknown) => ({ error })
						),
						SEARCH_BUDGET_MS
					)
				: null,
		]);

		let found: EasynewsResult[] = [];
		if (search && !search.timedOut) {
			if ('error' in search.value) {
				// A login Easynews refuses cannot play the casts either: say so.
				if (search.value.error instanceof EasynewsAuthError) {
					sendStreamFailure(res, 'en', 'credential');
					return;
				}
				console.error(
					'[Stremio-EN Stream] Easynews search failed:',
					search.value.error instanceof Error
						? search.value.error.message
						: 'Unknown error'
				);
			} else {
				found = search.value.results;
			}
		}

		const offered = new Set([...userCastItems, ...otherItems].map((item) => item.hash));
		const searchItems = found
			.filter((r) => !offered.has(hashOf(r.path)))
			.slice(0, Math.max(0, otherStreamsLimit - otherItems.length) + SPARE_HITS);

		// Easynews still lists files it can no longer serve: drop those before
		// Stremio offers them, as the debrid casts drop uncached hashes.
		const probe = await settleWithin(
			goneEasynewsPaths(credentials, [
				...userCastItems.map((item) => item.path),
				...otherItems.map((item) => item.path),
				...searchItems.map((r) => r.path),
			]),
			PROBE_BUDGET_MS
		);
		const gone = probe.timedOut ? new Set<string>() : probe.value;
		const live = <T extends { path: string }>(items: T[]) =>
			items.filter((item) => !gone.has(item.path));
		const liveUserCasts = live(userCastItems);
		const liveOtherCasts = live(otherItems);
		const liveSearch = live(searchItems);

		console.log('[Stremio-EN Stream] Stream stats:', {
			userCasts: userCastItems.length,
			otherCasts: otherItems.length,
			searchHits: found.length,
			gone: gone.size,
			searchTimedOut: !!search?.timedOut,
			probeTimedOut: probe.timedOut,
		});

		const playUrl = (path: string) =>
			`${process.env.DMM_ORIGIN}/api/stremio-en/${userid}/play/${hashOf(path)}?path=${encodeURIComponent(path)}`;
		// No torrent snapshot to read: the name is all Easynews gives, and it carries the resolution.
		const metadataOf = (name: string) => ({
			resolution: ptt.parse(name).resolution,
			languages: [],
		});
		const push = (name: string, path: string, sizeMb: number, isOwn: boolean) => {
			const metadata = metadataOf(name);
			streams.push({
				name: generateStreamName(sizeMb, metadata),
				// The title formatter URI-decodes: a literal % in a release name would throw.
				title: formatStremioStreamTitle(
					name.replace(/%/g, '%25'),
					sizeMb,
					metadata,
					isOwn,
					'EN'
				),
				url: playUrl(path),
				behaviorHints: {
					bingeGroup: releaseBingeGroup(
						'dmm-en',
						easynewsReleaseOf(splitEasynewsPath(path).name)
					),
					filename: path.slice(path.indexOf('/') + 1),
				},
			});
		};

		for (const item of liveUserCasts) push(item.filename, item.path, item.size, true);
		for (const item of liveOtherCasts) push(item.filename, item.path, item.size, false);
		// Search results fill what the cast pool left open, in the same "other
		// streams" budget the size-limits setting describes.
		const searchSlots = Math.max(0, otherStreamsLimit - liveOtherCasts.length);
		for (const result of liveSearch.slice(0, searchSlots)) {
			push(result.title, result.path, result.size / 1024 / 1024, false);
		}

		res.status(200).json({ streams, cacheMaxAge: 0 });
	} catch (error) {
		sendStreamError(res, 'en', error);
		return;
	}
}

export default withRateLimit(handler);
