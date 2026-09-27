import type { FribbAnimeEntry } from '@/services/anime/animeMapping';
import type { AnimeEntryRow } from '@/services/database/anime';
import rows from '@/test/fixtures/anime/anime-rows-franchises.json';
import fribb from '@/test/fixtures/anime/fribb-franchises.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import axios from 'axios';
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// What the anime page's metadata call needs from the Fribb dataset: a type
// the table got wrong, and the Kitsu id of a season the table has no row for.
// Rows, dataset entries and kitsu.io answers are production's (2026-09-27).

vi.mock('axios');
vi.mock('user-agents', () => ({
	default: vi.fn().mockImplementation(() => ({ toString: () => 'TestAgent/1.0' })),
}));
vi.mock('@/services/anime/simkl', () => ({ resolveImdbIdFromSimkl: async () => null }));

const tableRows = rows as AnimeEntryRow[];
vi.mock('@/services/repository', () => ({
	repository: {
		getAnimeByExternalId: async (source: string, id: number) => {
			const row = tableRows.find((r) => source === 'anidb' && r.anidb_id === id);
			return row
				? { ...row, description: 'row description', background_url: '', rating: 0 }
				: null;
		},
	},
}));
vi.mock('@/services/anime/animeFranchise', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/anime/animeFranchise')>();
	return {
		...actual,
		getFranchiseIndex: async () => actual.buildFranchiseIndex(fribb as FribbAnimeEntry[]),
	};
});

const FIXTURES = path.resolve(__dirname, '../../fixtures/anime');

describe('/api/info/anime and the Fribb dataset', () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.resetModules();
		// The addon answers dmm-01 with a 403, so production reads kitsu.io.
		vi.mocked(axios.get).mockRejectedValue(new Error('Request failed with status code 403'));
		global.fetch = vi.fn(async (url: RequestInfo | URL) => {
			const id = /kitsu\.io\/api\/edge\/anime\/(\d+)$/.exec(String(url))?.[1];
			const file = id ? path.join(FIXTURES, `kitsu-anime-${id}.json`) : '';
			try {
				const body = JSON.parse(readFileSync(file, 'utf8'));
				return { ok: true, status: 200, json: async () => body } as Response;
			} catch {
				return { ok: false, status: 404, json: async () => ({}) } as Response;
			}
		}) as typeof fetch;
	});
	afterEach(() => {
		global.fetch = originalFetch;
	});

	const info = async (animeid: string) => {
		const { default: handler } = await import('@/pages/api/info/anime');
		const res = createMockResponse();
		await handler(createMockRequest({ query: { animeid } }), res);
		return vi.mocked(res.json).mock.calls[0][0];
	};

	it("types Bookworm's fourth season as the TV season it is, which the row calls a SPECIAL", async () => {
		expect(tableRows.find((r) => r.anidb_id === 18302)?.type).toBe('SPECIAL');

		const body = await info('anidb-18302');

		expect(body.title).toMatch(/4th Season$/);
		expect(body.type).toBe('TV');
		expect(body.episodeCount).toBe(24);
	});

	it("resolves a season the table has no row for through the dataset's Kitsu id", async () => {
		expect(tableRows.some((r) => r.anidb_id === 18886)).toBe(false);

		const body = await info('anidb-18886');

		expect(body.title).toBe('Sousou no Frieren 2nd Season');
		expect(body.type).toBe('TV');
		expect(body.episodeCount).toBe(10);
	});

	it('types a no-IMDb ONA from the dataset too', async () => {
		const body = await info('anidb-17052');

		expect(body).toMatchObject({
			title: 'Dou Po Cangqiong: Nian Fan',
			type: 'ONA',
			imdbid: '',
		});
	});

	it('still answers the placeholder for an id nothing knows', async () => {
		const body = await info('anidb-999999');

		expect(body).toMatchObject({ title: 'Unknown', type: '', episodeCount: 0 });
	});
});
