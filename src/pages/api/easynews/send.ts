import { toResponse } from '@/pages/api/wanted';
import { MAX_WANTED_ITEMS } from '@/services/database/wantedItems';
import {
	EASYNEWS_NZB_PREFIX,
	EasynewsAuthError,
	EasynewsNzbError,
	fetchEasynewsNzb,
	isEasynewsPath,
	readCredentials,
	splitEasynewsPath,
} from '@/services/easynews';
import { hasTokenSecret } from '@/services/newznab/opaqueId';
import { isStoreConfigured, putStoredNzb } from '@/services/newznab/store';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { isNzbBlocked } from '@/services/takedown/blocklist';
import { NzbSanitizeError, sanitizeNzbAsync } from '@/utils/nzbSanitize';
import { requireSponsor } from '@/utils/requireSponsor';
import type { NextApiRequest, NextApiResponse } from 'next';

const IMDB_ID = /^tt\d{7,}$/;
const EPISODE = /S(\d+)E(\d+)/i;

/**
 * "Send to zurg": fetches one Easynews result's NZB with the caller's own login,
 * stores it cleaned under the `en` prefix, where the Newznab grab serves it, and
 * pins it on the sponsor's wanted list for their zurg to grab. Body:
 * `{username, password, path, sig, size?, imdbId, kind, title}`. Answers the
 * wanted item as `/api/wanted` does.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const payload = await requireSponsor(req, res);
	if (!payload) return;
	if (!(await checkRateLimitFor(`wanted:${payload.shortId}`, RATE_LIMIT_CONFIGS.wanted, res))) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	const credentials = readCredentials(req.body);
	if (!credentials) {
		return res.status(400).json({ error: 'Easynews username and password are required' });
	}
	const { path, sig, size, imdbId, kind, title } = (req.body ?? {}) as Record<string, unknown>;
	if (
		!isEasynewsPath(path) ||
		typeof sig !== 'string' ||
		!sig ||
		sig.length > 512 ||
		typeof imdbId !== 'string' ||
		!IMDB_ID.test(imdbId) ||
		(kind !== 'movie' && kind !== 'show') ||
		typeof title !== 'string' ||
		!title.trim() ||
		title.length > 512
	) {
		return res.status(400).json({
			error: 'Expected {"path", "sig", "imdbId": "tt…", "kind": "movie"|"show", "title"} with an Easynews login',
		});
	}
	const { hash, name } = splitEasynewsPath(path);
	const release = path.slice(path.indexOf('/') + 1);
	// matchesTarget only lets a season's episodes onto a show page; a multi-episode file is pinned to its first.
	const episode = kind === 'show' ? EPISODE.exec(release) : null;
	if (kind === 'show' && !episode) {
		return res.status(400).json({ error: 'This file names no episode (SxxEyy)' });
	}
	if (!isStoreConfigured() || !hasTokenSecret()) {
		return res.status(503).json({ error: 'DMM cannot store NZBs right now' });
	}

	try {
		const raw = await fetchEasynewsNzb(credentials, path, sig);
		let cleaned;
		try {
			cleaned = await sanitizeNzbAsync(raw);
		} catch (error) {
			if (error instanceof NzbSanitizeError) {
				return res.status(422).json({ error: error.message });
			}
			throw error;
		}
		// By the name the search lists it under, as withoutBlockedReleases judges it.
		if (await isNzbBlocked(cleaned.xml, name)) {
			return res.status(404).json({ error: 'No such item' });
		}
		// Awaited: a pin whose NZB is not stored sends zurg to a 300 "No such item".
		try {
			await putStoredNzb(EASYNEWS_NZB_PREFIX, hash, cleaned.xml);
		} catch (error) {
			console.error('Easynews send: NZB store write failed:', error);
			return res.status(503).json({ error: 'DMM could not store the NZB; try again' });
		}
		const row = await db.pinWanted(
			payload.shortId,
			{ imdbId, kind, title: title.trim() },
			{
				id: hash,
				release,
				size: Number.isSafeInteger(size) && (size as number) > 0 ? (size as number) : 0,
				...(episode && { season: Number(episode[1]), episode: Number(episode[2]) }),
				at: new Date().toISOString(),
			}
		);
		if (!row) {
			return res
				.status(409)
				.json({ error: `Your wanted list is full (${MAX_WANTED_ITEMS} titles)` });
		}
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json({ item: toResponse(row) });
	} catch (error) {
		if (error instanceof EasynewsAuthError) {
			return res.status(401).json({ error: error.message });
		}
		if (error instanceof EasynewsNzbError) {
			return res.status(422).json({ error: error.message });
		}
		// The message never carries the login or the sig: fetchEasynewsNzb names only the status.
		console.error('Easynews send failed:', error);
		return res.status(502).json({ error: 'Easynews did not hand out the NZB' });
	}
}
