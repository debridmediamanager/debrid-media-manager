import type { WantedItemRow } from '@/services/database/wantedItems';
import { TMDB_TV_APPEND } from '@/services/metadata';
import { getMetadataCache } from '@/services/metadataCache';
import { resolveWantedReused } from '@/services/wanted';

/**
 * The slice of Radarr's and Sonarr's v3 API that Seerr (and Overseerr and
 * Jellyseerr) calls, answered from a sponsor's wanted list, so a request made in
 * Seerr lands on the list their zurg fetches. Shapes follow Seerr's own client,
 * `server/api/servarr/{base,radarr,sonarr}.ts`.
 *
 * Radarr's numeric id is the TMDB id and Sonarr's the TheTVDB id: those are what
 * Seerr looks titles up by, and they are unique within one sponsor's list, so
 * the list needs no id column of its own.
 */

export type ArrApp = 'radarr' | 'sonarr';

export const ROOT_FOLDER = '/dmm';

/** Sonarr 4 has no language profiles, so Seerr does not ask for them. */
export function systemStatus(app: ArrApp, urlBase: string) {
	return {
		appName: app === 'radarr' ? 'Radarr' : 'Sonarr',
		instanceName: 'Debrid Media Manager',
		version: app === 'radarr' ? '5.0.0.0' : '4.0.0.0',
		urlBase,
	};
}

export const QUALITY_PROFILES = [{ id: 1, name: 'Any' }];
export const ROOT_FOLDERS = [
	{
		id: 1,
		path: ROOT_FOLDER,
		accessible: true,
		freeSpace: 0,
		totalSpace: 0,
		unmappedFolders: [],
	},
];

const yearOf = (date: unknown) => {
	const y = typeof date === 'string' ? Number.parseInt(date.slice(0, 4), 10) : NaN;
	return Number.isInteger(y) && y > 1800 ? y : 0;
};

function movieShape(
	m: { tmdbId: number; imdbId: string; title: string; year: number },
	row: WantedItemRow | null
) {
	return {
		...(row ? { id: m.tmdbId, added: row.createdAt.toISOString() } : {}),
		title: m.title,
		tmdbId: m.tmdbId,
		imdbId: m.imdbId,
		year: m.year,
		titleSlug: String(m.tmdbId),
		folderName: `${ROOT_FOLDER}/${m.title}`,
		path: `${ROOT_FOLDER}/${m.title}`,
		qualityProfileId: 1,
		profileId: 1,
		monitored: row !== null,
		isAvailable: true,
		// zurg acknowledged it, which Seerr reads as available
		hasFile: Boolean(row?.fulfilledAt),
		tags: [],
	};
}

type Season = { seasonNumber: number; monitored: boolean; statistics?: Record<string, number> };

function seriesShape(
	s: { tvdbId: number; imdbId: string; title: string; year: number; seasons: Season[] },
	row: WantedItemRow | null
) {
	return {
		...(row ? { id: s.tvdbId, added: row.createdAt.toISOString() } : {}),
		title: s.title,
		tvdbId: s.tvdbId,
		imdbId: s.imdbId,
		year: s.year,
		titleSlug: String(s.tvdbId),
		path: `${ROOT_FOLDER}/${s.title}`,
		qualityProfileId: 1,
		languageProfileId: 1,
		seasonFolder: true,
		seriesType: 'standard',
		monitored: row !== null,
		monitorNewItems: row && row.seasons === null ? 'all' : 'none',
		seasons: s.seasons,
		tags: [],
	};
}

/** Every film and show on the list that TMDB places, as Radarr or Sonarr lists them. */
export async function listLibrary(app: ArrApp, rows: WantedItemRow[]) {
	const kind = app === 'radarr' ? 'movie' : 'show';
	const out: any[] = [];
	for (const row of rows.filter((r) => r.kind === kind)) {
		const r = await resolveWantedReused(row);
		if (app === 'radarr' && r.tmdb) {
			out.push(
				movieShape(
					{ tmdbId: r.tmdb, imdbId: r.imdb, title: r.title, year: r.year ?? 0 },
					row
				)
			);
		} else if (app === 'sonarr' && r.tvdb) {
			const seasons = (r.seasons ?? []).map((s) => ({
				seasonNumber: s.season,
				monitored: true,
				// ponytail: zurg does not report episodes it holds, so Seerr shows wanted seasons as processing until its Plex/Jellyfin scan finds them
				statistics: {
					episodeFileCount: 0,
					episodeCount: s.episodes.length,
					totalEpisodeCount: s.episodes.length,
				},
			}));
			out.push(
				seriesShape(
					{ tvdbId: r.tvdb, imdbId: r.imdb, title: r.title, year: r.year ?? 0, seasons },
					row
				)
			);
		}
	}
	return out;
}

/** A film by TMDB id, from TMDB, marked as on the list when it is. Null when TMDB has no IMDb id for it. */
export async function lookUpMovie(tmdbId: number, rows: WantedItemRow[]) {
	const movie = await getMetadataCache().getTmdbMovieInfo(tmdbId);
	const imdbId = movie?.imdb_id;
	if (typeof imdbId !== 'string' || !imdbId) return null;
	const row = rows.find((r) => r.kind === 'movie' && r.imdbId === imdbId) ?? null;
	return movieShape(
		{ tmdbId, imdbId, title: movie.title, year: yearOf(movie.release_date) },
		row
	);
}

/** A show by TheTVDB id, with every regular season TMDB numbers. Null when TMDB cannot place it. */
export async function lookUpSeries(tvdbId: number, rows: WantedItemRow[]) {
	const cache = getMetadataCache();
	const found = await cache.getTmdbPassthrough(`find/${tvdbId}`, { external_source: 'tvdb_id' });
	const tmdb = found?.tv_results?.[0]?.id;
	if (typeof tmdb !== 'number') return null;
	const show = await cache.getTmdbTvInfo(tmdb, TMDB_TV_APPEND);
	const imdbId = show?.external_ids?.imdb_id;
	if (typeof imdbId !== 'string' || !imdbId) return null;
	const row = rows.find((r) => r.kind === 'show' && r.imdbId === imdbId) ?? null;
	const seasons: Season[] = (Array.isArray(show.seasons) ? show.seasons : [])
		.map((s: any) => s?.season_number)
		.filter((n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1)
		.map((n: number) => ({
			seasonNumber: n,
			monitored: row !== null && (row.seasons === null || row.seasons.includes(n)),
		}));
	return seriesShape(
		{ tvdbId, imdbId, title: show.name, year: yearOf(show.first_air_date), seasons },
		row
	);
}

/**
 * The seasons a Sonarr add or update asks for, as the wanted list keeps them:
 * null once every regular season is monitored, so seasons yet to air come too.
 */
export function wantedSeasons(asked: unknown, all: Season[]): number[] | null {
	const monitored = new Set(
		(Array.isArray(asked) ? asked : [])
			.filter(
				(s) =>
					s?.monitored === true && Number.isInteger(s.seasonNumber) && s.seasonNumber >= 1
			)
			.map((s) => s.seasonNumber as number)
	);
	if (all.length > 0 && all.every((s) => monitored.has(s.seasonNumber))) return null;
	return [...monitored].sort((a, b) => a - b);
}
