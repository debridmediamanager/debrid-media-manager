/**
 * Production's anime data on 2026-09-27, served the way the real data sources
 * serve it, for tests that run the anime routes end to end. See
 * `src/test/fixtures/anime/README.md` for where each file came from.
 */
// Types only from the modules tests mock: a value import of one would make
// that module's mock factory wait on this file while this file waits on it.
import type { FribbAnimeEntry } from '@/services/anime/animeMapping';
import { normalizeKitsuAnime } from '@/services/anime/kitsu';
import type { AnimeEntryRow } from '@/services/database/anime';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { existsSync, readFileSync } from 'fs';
import type { NextApiHandler } from 'next';
import path from 'path';
import { vi } from 'vitest';

const FIXTURES = path.resolve(__dirname, '../fixtures/anime');

export const hasAnimeFixture = (name: string) => existsSync(path.join(FIXTURES, name));
export const animeFixture = <T = any>(name: string): T =>
	JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));

/** The Fribb dataset entries at commit 8e4ec6a2, for `buildFranchiseIndex`. */
export const fixtureFribbEntries = () => animeFixture<FribbAnimeEntry[]>('fribb-franchises.json');

/** `AnimeService.getAnimeEntryRows`'s where clause, over the captured rows. */
export async function fixtureAnimeEntryRows({
	anidbIds,
	imdbIds,
}: {
	anidbIds: number[];
	imdbIds: string[];
}): Promise<AnimeEntryRow[]> {
	return animeFixture<AnimeEntryRow[]>('anime-rows-franchises.json').filter(
		(r) =>
			(r.anidb_id !== null && anidbIds.includes(r.anidb_id)) ||
			(r.imdb_id !== null && r.anidb_id !== null && imdbIds.includes(r.imdb_id))
	);
}

/** kitsu.io's answers to dmm-01, where one was captured. */
export async function fixtureKitsuLabel(kitsuId: number) {
	const name = `kitsu-anime-${kitsuId}.json`;
	if (!hasAnimeFixture(name)) return null;
	const meta = normalizeKitsuAnime(animeFixture(name).data.attributes);
	return { title: meta.title, poster: meta.poster };
}

/** The stored `anime:anidb-*` row, or null for an entry nothing was scraped for. */
export async function fixtureScrapedTrue(key: string) {
	const name = `scrapedtrue-${key.replace(':', '-')}.json`;
	return hasAnimeFixture(name) ? animeFixture(name) : null;
}

/** Runs a route handler for a URL and answers like axios or fetch would. */
export async function callAnimeRoute(handler: NextApiHandler, url: string) {
	const query = Object.fromEntries(new URL(url, 'http://dmm').searchParams);
	const res = createMockResponse();
	await handler(createMockRequest({ query }), res);
	const status = vi.mocked(res.status).mock.calls[0]?.[0] ?? 200;
	const data = vi.mocked(res.json).mock.calls[0]?.[0];
	return { status, data };
}
