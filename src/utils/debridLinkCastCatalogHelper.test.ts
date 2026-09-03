import { getSeedboxTorrent, listSeedboxTorrents, SEEDBOX_PAGE_SIZE } from '@/services/debridLink';
import { repository } from '@/services/repository';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	debridLinkMetaId,
	getDebridLinkDMMItem,
	getDebridLinkDMMLibrary,
	PAGE_SIZE,
	parseDebridLinkMetaId,
} from './debridLinkCastCatalogHelper';

vi.mock('@/services/repository');
vi.mock('@/services/debridLink', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/debridLink')>('@/services/debridLink');
	return {
		...actual,
		listSeedboxTorrents: vi.fn(),
		getSeedboxTorrent: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockList = vi.mocked(listSeedboxTorrents);
const mockById = vi.mocked(getSeedboxTorrent);

const SEED = 'https://seed41.debrid.link/dl';

const torrent = (id: string, name: string, status = 100, files: unknown[] = []) =>
	({ id, name, status, downloadPercent: 100, files }) as any;

describe('debridLinkCastCatalogHelper', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_ORIGIN = 'https://dmm.test';
		mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue({ apiKey: 'dl-token' });
		mockList.mockResolvedValue({ torrents: [], pagination: null });
		mockById.mockResolvedValue(null);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	// Debrid-Link has one row shape, so the meta id carries no kind character -
	// unlike `dmm-pm:folder:` / `dmm-pm:file:`.
	describe('meta ids', () => {
		it('round-trips a torrent id', () => {
			expect(parseDebridLinkMetaId(debridLinkMetaId('abc123'))).toBe('abc123');
		});

		it.each([
			'dmm:RDTORRENT',
			'dmm-tb:1',
			'dmm-ad:2',
			'dmm-pm:folder:f1',
			'dmm-oc:r1',
			'dmm-dl:',
		])('refuses %s', (id) => {
			expect(parseDebridLinkMetaId(id)).toBeNull();
		});
	});

	describe('getDebridLinkDMMLibrary', () => {
		it('401s a user with no profile', async () => {
			mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue(null);
			expect(await getDebridLinkDMMLibrary('u', 1)).toMatchObject({ status: 401 });
		});

		// An unfinished torrent has no download URLs, so it would render as an
		// entry that cannot play.
		it('lists only finished torrents', async () => {
			mockList.mockResolvedValue({
				torrents: [
					torrent('t1', 'Done'),
					// 6 is VERIFICATION|DOWNLOADING - the vendor's own sample value,
					// and equal to none of the enum members.
					torrent('t2', 'Half way', 6),
					torrent('t3', 'Queued', 1),
				],
				pagination: null,
			});

			const result = (await getDebridLinkDMMLibrary('u', 1)) as any;

			expect(result.data.metas).toEqual([{ id: 'dmm-dl:t1', name: 'Done', type: 'other' }]);
		});

		// Walking the whole account on every catalog scroll is the request pattern
		// the hour-long lockout punishes - one request per page, always.
		it('asks Debrid-Link for one page rather than walking the account', async () => {
			await getDebridLinkDMMLibrary('u', 1);
			expect(mockList).toHaveBeenCalledTimes(1);
			expect(mockList.mock.calls[0][1]).toMatchObject({
				page: 0,
				perPage: SEEDBOX_PAGE_SIZE,
			});
		});

		it('windows the Stremio page inside the Debrid-Link page', async () => {
			mockList.mockResolvedValue({
				torrents: Array.from({ length: SEEDBOX_PAGE_SIZE }, (_, i) =>
					torrent(`t${i}`, `Item ${i}`)
				),
				pagination: { page: 0, pages: 1, next: -1, previous: -1 },
			});

			const first = (await getDebridLinkDMMLibrary('u', 1)) as any;
			const second = (await getDebridLinkDMMLibrary('u', 2)) as any;

			expect(first.data.metas.map((m: any) => m.id)).toEqual(
				Array.from({ length: PAGE_SIZE }, (_, i) => `dmm-dl:t${i}`)
			);
			expect(second.data.metas[0].id).toBe(`dmm-dl:t${PAGE_SIZE}`);
			expect(mockList.mock.calls[1][1]).toMatchObject({ page: 0 });
		});

		it('reports more when Debrid-Link has another page', async () => {
			mockList.mockResolvedValue({
				torrents: [torrent('t1', 'Only one')],
				pagination: { page: 0, pages: 2, next: 1, previous: -1 },
			});

			const result = (await getDebridLinkDMMLibrary('u', 1)) as any;
			expect(result.data.hasMore).toBe(true);
		});

		it('reports no more at the end of the list', async () => {
			mockList.mockResolvedValue({
				torrents: [torrent('t1', 'Only one')],
				pagination: { page: 0, pages: 1, next: -1, previous: -1 },
			});

			const result = (await getDebridLinkDMMLibrary('u', 1)) as any;
			expect(result.data.hasMore).toBe(false);
		});
	});

	describe('getDebridLinkDMMItem', () => {
		it('401s a user with no profile', async () => {
			mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue(null);
			expect(await getDebridLinkDMMItem('u', 't1')).toMatchObject({ status: 401 });
		});

		// A Debrid-Link URL is a keyless capability that keeps serving after the
		// torrent is deleted, and a meta can sit in a client cache indefinitely -
		// so it must never become the stream url.
		it('points every stream at the play route, never at the keyless URL', async () => {
			mockById.mockResolvedValue(
				torrent('t1', 'Show.S01', 100, [
					{
						id: 'f0',
						name: 'Show.S01/Show.S01E01.mkv',
						size: 1024 ** 3,
						downloadUrl: `${SEED}/t1-0/Show.S01E01.mkv`,
					},
					{
						id: 'f1',
						name: 'poster.jpg',
						size: 10,
						downloadUrl: `${SEED}/t1-1/poster.jpg`,
					},
				])
			);

			const result = (await getDebridLinkDMMItem('u', 't1')) as any;

			expect(result.data.meta.videos).toHaveLength(1);
			expect(result.data.meta.videos[0].streams[0].url).toBe(
				`https://dmm.test/api/stremio-dl/u/play/item/t1?file=${encodeURIComponent('Show.S01/Show.S01E01.mkv')}`
			);
			expect(JSON.stringify(result.data)).not.toContain('debrid.link');
		});

		// One request: the seedbox listing already carries the name, the sizes and
		// a live URL per file, which no other provider here manages.
		it('needs one Debrid-Link call for the whole listing', async () => {
			mockById.mockResolvedValue(
				torrent('t1', 'Movie', 100, [
					{ id: 'f0', name: 'Movie.mkv', size: 5, downloadUrl: `${SEED}/t1-0/Movie.mkv` },
				])
			);

			await getDebridLinkDMMItem('u', 't1');
			expect(mockById).toHaveBeenCalledTimes(1);
		});

		it('404s an unknown torrent id', async () => {
			mockById.mockResolvedValue(null);
			expect(await getDebridLinkDMMItem('u', 'nope')).toMatchObject({ status: 404 });
		});

		it('404s an item with no video in it', async () => {
			mockById.mockResolvedValue(
				torrent('t1', 'Docs', 100, [
					{
						id: 'f0',
						name: 'readme.txt',
						size: 5,
						downloadUrl: `${SEED}/t1-0/readme.txt`,
					},
				])
			);
			expect(await getDebridLinkDMMItem('u', 't1')).toMatchObject({ status: 404 });
		});

		it('500s when the listing itself fails', async () => {
			mockById.mockRejectedValue(new Error('floodDetected'));
			expect(await getDebridLinkDMMItem('u', 't1')).toMatchObject({ status: 500 });
		});
	});
});
