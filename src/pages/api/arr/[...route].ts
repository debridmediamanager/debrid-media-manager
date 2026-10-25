import {
	type ArrApp,
	listLibrary,
	lookUpMovie,
	lookUpSeries,
	QUALITY_PROFILES,
	ROOT_FOLDERS,
	systemStatus,
	wantedSeasons,
} from '@/services/arr';
import { MAX_WANTED_ITEMS } from '@/services/database/wantedItems';
import { NEWZNAB_AUTH_MESSAGES, resolveNewznabSponsor } from '@/services/newznab/auth';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * DMM as a Radarr and a Sonarr, for Seerr / Overseerr / Jellyseerr: a request
 * approved there is added to the sponsor's wanted list, which their zurg fetches.
 * Seerr is pointed at this host with URL base `/api/arr/radarr` or
 * `/api/arr/sonarr` and appends `/api/v3/<endpoint>`; it sends the DMM API key
 * as `apikey=`, the same gate as Newznab. See `services/arr.ts` and docs/sponsor-api.md.
 *
 * Downloads, queues, commands and tags have nothing behind them, since zurg polls
 * the list itself, so they answer empty or echo back what was sent.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const [app, api, version, ...rest] = Array.isArray(req.query.route) ? req.query.route : [];
	// Seerr's "Open in Radarr/Sonarr" link: <url base>/movie/<tmdb> or /series/<tvdb>, no key.
	if (
		((app === 'radarr' && api === 'movie') || (app === 'sonarr' && api === 'series')) &&
		idOf(version) &&
		rest.length === 0
	) {
		const found =
			app === 'radarr'
				? await lookUpMovie(idOf(version), [])
				: await lookUpSeries(idOf(version), []);
		if (!found) return res.status(404).json({ message: 'NotFound' });
		return res.redirect(302, `/${app === 'radarr' ? 'movie' : 'show'}/${found.imdbId}`);
	}
	if ((app !== 'radarr' && app !== 'sonarr') || api !== 'api' || version !== 'v3') {
		return res.status(404).json({ message: 'NotFound' });
	}
	const auth = await resolveNewznabSponsor(req);
	if ('errorCode' in auth) {
		return res.status(401).json({ message: NEWZNAB_AUTH_MESSAGES[auth.errorCode] });
	}
	const { shortId } = auth.sponsor;
	if (!(await checkRateLimitFor(`arr:${shortId}`, RATE_LIMIT_CONFIGS.arr, res))) {
		return res.status(429).json({ message: 'Rate limit exceeded' });
	}

	try {
		return await route(app, rest.join('/').toLowerCase(), shortId, req, res);
	} catch (error) {
		console.error(`[arr] ${app} ${req.method} ${rest.join('/')} failed`, error);
		return res.status(500).json({ message: 'Could not read the wanted list' });
	}
}

const idOf = (raw: unknown) => {
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : 0;
};

async function route(
	app: ArrApp,
	path: string,
	shortId: string,
	req: NextApiRequest,
	res: NextApiResponse
) {
	const method = req.method ?? 'GET';
	const item = app === 'radarr' ? 'movie' : 'series';
	const [head, sub] = path.split('/');

	if (method === 'GET' && path === 'system/status') {
		return res.status(200).json(systemStatus(app, `/api/arr/${app}`));
	}
	if (method === 'GET' && path === 'qualityprofile')
		return res.status(200).json(QUALITY_PROFILES);
	if (method === 'GET' && path === 'languageprofile')
		return res.status(200).json([{ id: 1, name: 'Any' }]);
	if (method === 'GET' && path === 'rootfolder') return res.status(200).json(ROOT_FOLDERS);
	if (method === 'GET' && path === 'tag') return res.status(200).json([]);
	if ((method === 'POST' || method === 'PUT') && head === 'tag') {
		return res.status(201).json({ id: idOf(sub) || 1, label: String(req.body?.label ?? '') });
	}
	if (method === 'GET' && path === 'queue') {
		return res.status(200).json({ page: 1, pageSize: 10, totalRecords: 0, records: [] });
	}
	if (method === 'POST' && path === 'command')
		return res.status(201).json({ id: 1, ...req.body });
	if (method === 'GET' && path === 'episode') return res.status(200).json([]);

	if (head !== item) return res.status(404).json({ message: 'NotFound' });
	const rows = await db.listWanted(shortId);

	if (method === 'GET' && sub === 'lookup') {
		const term = String(req.query.term ?? '');
		const [, prefix, id] = /^(tmdb|tvdb):(\d+)$/.exec(term) ?? [];
		if (prefix !== (app === 'radarr' ? 'tmdb' : 'tvdb')) {
			// ponytail: title lookups (Seerr's TheTVDB override picker) answer nothing
			return res.status(200).json([]);
		}
		const found =
			app === 'radarr'
				? await lookUpMovie(Number(id), rows)
				: await lookUpSeries(Number(id), rows);
		return res.status(200).json(found ? [found] : []);
	}

	if (method === 'GET') {
		const library = await listLibrary(app, rows);
		const id = idOf(sub);
		if (id) {
			const one = library.find((x) => x.id === id);
			return one ? res.status(200).json(one) : res.status(404).json({ message: 'NotFound' });
		}
		const filter = idOf(req.query[app === 'radarr' ? 'tmdbId' : 'tvdbId']);
		return res.status(200).json(filter ? library.filter((x) => x.id === filter) : library);
	}

	if (method === 'DELETE') {
		const id = idOf(sub);
		const found = id
			? app === 'radarr'
				? await lookUpMovie(id, rows)
				: await lookUpSeries(id, rows)
			: null;
		if (!found?.monitored) return res.status(404).json({ message: 'NotFound' });
		await db.unwant(shortId, found.imdbId);
		return res.status(200).json({});
	}

	if (method === 'POST' || method === 'PUT') {
		const id = idOf(req.body?.[app === 'radarr' ? 'tmdbId' : 'tvdbId']);
		const found = id
			? app === 'radarr'
				? await lookUpMovie(id, rows)
				: await lookUpSeries(id, rows)
			: null;
		if (!found) {
			return res
				.status(400)
				.json({ message: 'TMDB has no IMDb id for this title, so it cannot be wanted' });
		}
		const seasons = 'seasons' in found ? wantedSeasons(req.body?.seasons, found.seasons) : null;
		if (seasons?.length === 0)
			return res.status(400).json({ message: 'No season is monitored' });
		const row = await db.want(shortId, {
			imdbId: found.imdbId,
			kind: app === 'radarr' ? 'movie' : 'show',
			title: found.title,
			seasons,
		});
		if (!row) {
			return res
				.status(409)
				.json({ message: `Your wanted list is full (${MAX_WANTED_ITEMS} titles)` });
		}
		const added =
			app === 'radarr' ? await lookUpMovie(id, [row]) : await lookUpSeries(id, [row]);
		return res.status(method === 'POST' ? 201 : 202).json(added);
	}

	return res.status(405).json({ message: 'Method not allowed' });
}
