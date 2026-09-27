import { transformExternalStream } from '@/hooks/useExternalSources';
import type { SearchResult } from '@/services/mediasearch';
import { hasSubstantialTitle } from '@/services/mediasearch';
import type { UsenetResult } from '@/services/nzb2rd';
import fs from 'fs';
import path from 'path';

/**
 * The season page's inputs as production served them, from
 * `src/test/fixtures/seasonEpisodes` (see its README).
 */
const DIR = path.join(__dirname, '../fixtures/seasonEpisodes');

export type SeasonFixtureId =
	| 'tt13706018-s3'
	| 'tt22248376-s1'
	| 'tt0121955-s29'
	| 'tt0108778-s10'
	| 'tt0386676-s4';

type DmmCapture = { pages: { page: number; status: number; results?: SearchResult[] }[] };
type AddonCapture = {
	sources: Record<
		string,
		Record<string, { status: number | null; body: { streams?: unknown[] } }>
	>;
};

const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')) as T;

const imdbOf = (id: SeasonFixtureId) => id.split('-')[0];

export const showInfoFixture = (id: SeasonFixtureId) => read<any>(`info-show-${imdbOf(id)}.json`);

export const animeByImdbFixture = (id: SeasonFixtureId) =>
	read<{ results: Record<string, unknown[]> }>(`anime-by-imdb-${imdbOf(id)}.json`);

/** `/api/torrents/tv` pages in the order the page asks for them; the last is empty. */
export const dmmPagesFixture = (id: SeasonFixtureId) => read<DmmCapture>(`dmm-tv-${id}.json`).pages;

/** Each addon's answer per episode, as `fetchEpisodeFromExternalSource` receives it. */
export const addonFixture = (id: SeasonFixtureId) =>
	read<AddonCapture>(`addons-${id}.json`).sources;

export const usenetFixture = (id: SeasonFixtureId): UsenetResult[] | null => {
	const name = `usenet-${id}.json`;
	if (!fs.existsSync(path.join(DIR, name))) return null;
	return read<{ results: UsenetResult[] }>(name).results;
};

/** An addon's rows for one episode, transformed exactly as the page does. */
export function addonRows(id: SeasonFixtureId, source: string, episode: number): SearchResult[] {
	const answer = addonFixture(id)[source]?.[String(episode)];
	const streams = answer?.status === 200 ? (answer.body.streams ?? []) : [];
	return streams
		.map((stream) => transformExternalStream(stream, source))
		.filter((row): row is SearchResult => row !== null)
		.map((row) => ({ ...row, imdbId: imdbOf(id) }));
}

/** Every name any source answered for the season, before the page drops duplicate hashes. */
export function capturedTitles(id: SeasonFixtureId): Set<string> {
	const titles = new Set<string>();
	for (const page of dmmPagesFixture(id)) {
		for (const row of page.results ?? []) titles.add(row.title);
	}
	for (const [source, episodes] of Object.entries(addonFixture(id))) {
		for (const episode of Object.keys(episodes)) {
			for (const row of addonRows(id, source, Number(episode))) titles.add(row.title);
		}
	}
	for (const row of usenetFixture(id) ?? []) titles.add(row.title);
	return titles;
}

/**
 * The page's merged torrent list, in the order the page builds it: DMM's first
 * page, every addon answer in episode order, then DMM's later pages as "Show
 * More Results" asks for them, dropping the titles `processSourceResults`
 * drops. Like the page, a batch is checked against the rows already held and
 * not against itself, so a hash an addon lists twice in one answer is kept
 * twice.
 */
export function mergedSeasonRows(
	id: SeasonFixtureId,
	{ dmmPages = Infinity }: { dmmPages?: number } = {}
): SearchResult[] {
	const titleStartsWithYear = /^\d{4}\b/.test(showInfoFixture(id).title);
	const merged: SearchResult[] = [];
	const held = new Set<string>();
	const take = (rows: SearchResult[]) => {
		const fresh = rows.filter(
			(row) =>
				row.hash &&
				!held.has(row.hash) &&
				hasSubstantialTitle(row.title) &&
				(titleStartsWithYear || !/^\d{4}\)/.test(row.title))
		);
		for (const row of fresh) {
			held.add(row.hash);
			merged.push(row);
		}
	};
	const pages = dmmPagesFixture(id).slice(0, dmmPages);
	take(pages[0]?.results ?? []);
	for (const [source, episodes] of Object.entries(addonFixture(id))) {
		const order = Object.keys(episodes)
			.map(Number)
			.sort((a, b) => a - b);
		for (const episode of order) take(addonRows(id, source, episode));
	}
	for (const page of pages.slice(1)) take(page.results ?? []);
	return merged;
}
