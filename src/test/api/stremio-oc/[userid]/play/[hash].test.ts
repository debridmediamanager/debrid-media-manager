import handler from '@/pages/api/stremio-oc/[userid]/play/[hash]';
import {
	addOffcloudCloud,
	exploreOffcloudCloud,
	getOffcloudCacheInfo,
	getOffcloudCloudStatus,
	getOffcloudHistory,
	removeOffcloudCloud,
} from '@/services/offcloud';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/offcloud', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/offcloud')>('@/services/offcloud');
	return {
		...actual,
		addOffcloudCloud: vi.fn(),
		exploreOffcloudCloud: vi.fn(),
		getOffcloudCacheInfo: vi.fn(),
		getOffcloudCloudStatus: vi.fn(),
		getOffcloudHistory: vi.fn(),
		removeOffcloudCloud: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockAdd = vi.mocked(addOffcloudCloud);
const mockExplore = vi.mocked(exploreOffcloudCloud);
const mockCacheInfo = vi.mocked(getOffcloudCacheInfo);
const mockStatus = vi.mocked(getOffcloudCloudStatus);
const mockHistory = vi.mocked(getOffcloudHistory);
const mockRemove = vi.mocked(removeOffcloudCloud);

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const CDN = 'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/n-sto/obj/100000001/1788380601/tok/sig';

const request = (query: Record<string, string> = {}) =>
	createMockRequest({ query: { userid: 'u', hash: HASH, ...query } });

/** Lets the fire-and-forget cleanup in the handler's `finally` settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('/api/stremio-oc/[userid]/play/[hash]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue({ apiKey: 'viewer-key' });
		mockHistory.mockResolvedValue([]);
		mockAdd.mockResolvedValue({
			requestId: 'req1',
			fileName: 'Release',
			status: 'downloaded',
			originalLink: `magnet:?xt=urn:btih:${HASH}`,
		});
		mockExplore.mockResolvedValue([`${CDN}/Show.S01E01.mkv`, `${CDN}/Show.S01E02.mkv`]);
		mockCacheInfo.mockResolvedValue([
			{
				source: '',
				cached: true,
				files: [
					{ folder: 'Show.S01', filename: 'Show.S01E01.mkv', size: 500 },
					{ folder: 'Show.S01', filename: 'Show.S01E02.mkv', size: 100 },
				],
			},
		]);
		mockRemove.mockResolvedValue({ success: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns 500 when the viewer has no profile', async () => {
		mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue(null);
		await handler(request(), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	// The whole point of the design: nothing is redeemed, the link is minted here
	// with the *viewer's* key. A stored Offcloud URL would carry the caster's
	// account token to every viewer.
	it('mints the link with the viewer key rather than redeeming a stored one', async () => {
		await handler(request({ file: 'Show.S01/Show.S01E02.mkv' }), res);

		expect(mockAdd).toHaveBeenCalledWith('viewer-key', HASH);
		expect(res.redirect).toHaveBeenCalledWith(`${CDN}/Show.S01E02.mkv`);
	});

	it('falls back to the biggest file when no path was stored', async () => {
		await handler(request(), res);
		expect(res.redirect).toHaveBeenCalledWith(`${CDN}/Show.S01E01.mkv`);
	});

	// Removal was measured not to break links already minted, so the item this
	// route created for itself is cleaned up rather than left in the viewer's
	// cloud.
	it('removes the item it added, after the redirect', async () => {
		await handler(request(), res);
		await flush();

		expect(res.redirect).toHaveBeenCalled();
		expect(mockRemove).toHaveBeenCalledWith('viewer-key', 'req1');
	});

	// `POST /api/cloud` is idempotent while an item lives, so an add on a hash
	// the viewer already holds returns their own requestId. Removing it would
	// delete a library item they put there on purpose.
	it('never removes an item the viewer already had', async () => {
		mockHistory.mockResolvedValue([
			{
				requestId: 'existing',
				fileName: 'Release',
				status: 'downloaded',
				originalLink: `magnet:?xt=urn:btih:${HASH.toUpperCase()}&tr=x`,
			},
		]);

		await handler(request(), res);
		await flush();

		expect(mockAdd).not.toHaveBeenCalled();
		expect(mockExplore).toHaveBeenCalledWith('viewer-key', 'existing');
		expect(mockRemove).not.toHaveBeenCalled();
	});

	// Not knowing must never license a delete.
	it('does not remove when the history probe failed', async () => {
		mockHistory.mockRejectedValue(new Error('offcloud down'));

		await handler(request(), res);
		await flush();

		expect(mockAdd).toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalled();
		expect(mockRemove).not.toHaveBeenCalled();
	});

	// Offcloud accepts an unusable magnet with a 200 and parks it in `created`
	// with "Loading..." forever. It never finishes and never fails, so the only
	// escape is a bounded wait plus a removal.
	it('gives up on a zombie and cleans it up rather than hanging', async () => {
		vi.useFakeTimers();
		mockAdd.mockResolvedValue({
			requestId: 'zombie',
			fileName: 'Loading...',
			status: 'created',
			originalLink: `magnet:?xt=urn:btih:${HASH}`,
		});
		mockStatus.mockResolvedValue({
			requestId: 'zombie',
			status: 'created',
			fileName: 'Loading...',
			progress: null,
			message: 'Loading...',
		});

		const pending = handler(request(), res);
		await vi.advanceTimersByTimeAsync(20_000);
		await pending;
		await vi.advanceTimersByTimeAsync(0);

		expect(res.status).toHaveBeenCalledWith(504);
		expect(res.redirect).not.toHaveBeenCalled();
		expect(mockRemove).toHaveBeenCalledWith('viewer-key', 'zombie');
	});

	// A real transfer will finish on its own and the next attempt picks it out
	// of history - deleting it would throw away the download.
	it('leaves a genuinely downloading item alone', async () => {
		vi.useFakeTimers();
		mockAdd.mockResolvedValue({
			requestId: 'inflight',
			fileName: 'Release',
			status: 'downloading',
			originalLink: `magnet:?xt=urn:btih:${HASH}`,
		});
		mockStatus.mockResolvedValue({
			requestId: 'inflight',
			status: 'downloading',
			fileName: 'Release',
			progress: 12,
			message: null,
		});

		const pending = handler(request(), res);
		await vi.advanceTimersByTimeAsync(20_000);
		await pending;
		await vi.advanceTimersByTimeAsync(0);

		expect(res.status).toHaveBeenCalledWith(504);
		expect(mockRemove).not.toHaveBeenCalled();
	});

	// cache/info only supplies names and sizes; explore alone still yields the
	// decoded basename, which is all the file match needs.
	it('still plays when cache/info fails', async () => {
		mockCacheInfo.mockRejectedValue(new Error('down'));

		await handler(request({ file: 'Show.S01/Show.S01E02.mkv' }), res);

		expect(res.redirect).toHaveBeenCalledWith(`${CDN}/Show.S01E02.mkv`);
	});

	it('errors rather than redirecting somewhere else when the file is gone', async () => {
		await handler(request({ file: 'Show.S09E99.mkv' }), res);
		expect(res.redirect).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('errors when the release holds no video at all', async () => {
		mockExplore.mockResolvedValue([`${CDN}/readme.txt`]);
		mockCacheInfo.mockResolvedValue([{ source: '', cached: true, files: [] }]);

		await handler(request(), res);

		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('never caches the redirect', async () => {
		await handler(request(), res);
		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'no-store, no-cache, must-revalidate'
		);
	});

	it('validates the query parameters', async () => {
		await handler(createMockRequest({ query: { userid: 'u' } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});
});
