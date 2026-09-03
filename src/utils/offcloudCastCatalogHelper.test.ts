import {
	exploreOffcloudCloud,
	getOffcloudCacheInfo,
	getOffcloudHistory,
} from '@/services/offcloud';
import { repository } from '@/services/repository';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getOffcloudDMMItem,
	getOffcloudDMMLibrary,
	offcloudMetaId,
	PAGE_SIZE,
	parseOffcloudMetaId,
} from './offcloudCastCatalogHelper';

vi.mock('@/services/repository');
vi.mock('@/services/offcloud', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/offcloud')>('@/services/offcloud');
	return {
		...actual,
		exploreOffcloudCloud: vi.fn(),
		getOffcloudCacheInfo: vi.fn(),
		getOffcloudHistory: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockExplore = vi.mocked(exploreOffcloudCloud);
const mockCacheInfo = vi.mocked(getOffcloudCacheInfo);
const mockHistory = vi.mocked(getOffcloudHistory);

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const CDN = 'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/n-sto/obj/100000001/1788380601/tok/sig';

const historyItem = (requestId: string, fileName: string, status = 'downloaded') => ({
	requestId,
	fileName,
	status,
	originalLink: `magnet:?xt=urn:btih:${HASH}&dn=${fileName}`,
});

describe('offcloudCastCatalogHelper', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_ORIGIN = 'https://dmm.test';
		mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue({ apiKey: 'oc-key' });
		mockHistory.mockResolvedValue([]);
		mockCacheInfo.mockResolvedValue([]);
		mockExplore.mockResolvedValue([]);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	// Offcloud has one row shape, so the meta id carries no kind character -
	// unlike `dmm-pm:folder:` / `dmm-pm:file:`.
	describe('meta ids', () => {
		it('round-trips a request id', () => {
			expect(parseOffcloudMetaId(offcloudMetaId('abc123'))).toBe('abc123');
		});

		it.each([
			'dmm:RDTORRENT',
			'dmm-tb:1',
			'dmm-ad:2',
			'dmm-pm:folder:f1',
			'dmm-dl:seed1',
			'dmm-oc:',
		])('refuses %s', (id) => {
			expect(parseOffcloudMetaId(id)).toBeNull();
		});
	});

	describe('getOffcloudDMMLibrary', () => {
		it('401s a user with no profile', async () => {
			mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue(null);
			expect(await getOffcloudDMMLibrary('u', 1)).toMatchObject({ status: 401 });
		});

		// `cloud/explore` on an unfinished item hands back nothing, and a row
		// stuck in `created` may be a zombie Offcloud will never finish.
		it('lists only finished items', async () => {
			mockHistory.mockResolvedValue([
				historyItem('r1', 'Done.mkv'),
				historyItem('r2', 'Stuck', 'created'),
				historyItem('r3', 'Broken', 'error'),
			] as any);

			const result = (await getOffcloudDMMLibrary('u', 1)) as any;

			expect(result.data.metas).toEqual([
				{ id: 'dmm-oc:r1', name: 'Done.mkv', type: 'other' },
			]);
		});

		it('cuts the page client-side, since cloud/history has no paging', async () => {
			mockHistory.mockResolvedValue(
				Array.from({ length: PAGE_SIZE * 2 + 1 }, (_, i) =>
					historyItem(`r${i}`, `Item ${i}`)
				) as any
			);

			const first = (await getOffcloudDMMLibrary('u', 1)) as any;
			const third = (await getOffcloudDMMLibrary('u', 3)) as any;

			expect(first.data.metas).toHaveLength(PAGE_SIZE);
			expect(first.data.hasMore).toBe(true);
			expect(third.data.metas).toHaveLength(1);
			expect(third.data.hasMore).toBe(false);
		});
	});

	describe('getOffcloudDMMItem', () => {
		it('401s a user with no profile', async () => {
			mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue(null);
			expect(await getOffcloudDMMItem('u', 'r1')).toMatchObject({ status: 401 });
		});

		// The signed explore URL carries the account's own token and a mint
		// timestamp, and a meta can sit in a client cache for far longer than the
		// signature lives - so it must never become the stream url.
		it('points every stream at the play route, never at the signed CDN url', async () => {
			mockExplore.mockResolvedValue([`${CDN}/Show.S01E01.mkv`, `${CDN}/poster.jpg`]);
			mockHistory.mockResolvedValue([historyItem('r1', 'Show.S01')] as any);
			mockCacheInfo.mockResolvedValue([
				{
					source: '',
					cached: true,
					files: [{ folder: 'Show.S01', filename: 'Show.S01E01.mkv', size: 1024 ** 3 }],
				},
			]);

			const result = (await getOffcloudDMMItem('u', 'r1')) as any;

			expect(result.data.meta.videos).toHaveLength(1);
			const url = result.data.meta.videos[0].streams[0].url;
			expect(url).toBe(
				`https://dmm.test/api/stremio-oc/u/play/item/r1?file=${encodeURIComponent('Show.S01/Show.S01E01.mkv')}`
			);
			expect(JSON.stringify(result.data)).not.toContain('energycdn.com');
		});

		// cache/info needs the magnet form; a bare hash there silently answers
		// `cached: false`. The hash comes off the history row's originalLink.
		it('asks cache/info for sizes using the hash from the original link', async () => {
			mockExplore.mockResolvedValue([`${CDN}/Movie.mkv`]);
			mockHistory.mockResolvedValue([historyItem('r1', 'Movie')] as any);

			await getOffcloudDMMItem('u', 'r1');

			expect(mockCacheInfo).toHaveBeenCalledWith('oc-key', [HASH]);
		});

		it('still renders when history and cache/info both fail', async () => {
			mockExplore.mockResolvedValue([`${CDN}/Movie.mkv`]);
			mockHistory.mockRejectedValue(new Error('down'));

			const result = (await getOffcloudDMMItem('u', 'r1')) as any;

			expect(result.status).toBe(200);
			expect(result.data.meta.videos).toHaveLength(1);
			expect(mockCacheInfo).not.toHaveBeenCalled();
		});

		it('404s an item with no video in it', async () => {
			mockExplore.mockResolvedValue([`${CDN}/readme.txt`]);
			expect(await getOffcloudDMMItem('u', 'r1')).toMatchObject({ status: 404 });
		});

		it('500s when explore itself fails', async () => {
			mockExplore.mockRejectedValue(new Error('Request not found.'));
			expect(await getOffcloudDMMItem('u', 'r1')).toMatchObject({ status: 500 });
		});
	});
});
