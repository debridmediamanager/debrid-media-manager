import handler from '@/pages/api/stremio-oc/[userid]/play/item/[id]';
import { addOffcloudCloud, exploreOffcloudCloud, removeOffcloudCloud } from '@/services/offcloud';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/offcloud', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/offcloud')>('@/services/offcloud');
	return {
		...actual,
		addOffcloudCloud: vi.fn(),
		exploreOffcloudCloud: vi.fn(),
		removeOffcloudCloud: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockExplore = vi.mocked(exploreOffcloudCloud);

const CDN = 'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/n-sto/obj/100000001/1788380601/tok/sig';

describe('/api/stremio-oc/[userid]/play/item/[id]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue({ apiKey: 'oc-key' });
		mockExplore.mockResolvedValue([`${CDN}/A.mkv`, `${CDN}/B.mkv`]);
	});

	it('mints the link at play time and never caches the redirect', async () => {
		await handler(createMockRequest({ query: { userid: 'u', id: 'r1', file: 'B.mkv' } }), res);

		expect(mockExplore).toHaveBeenCalledWith('oc-key', 'r1');
		expect(res.redirect).toHaveBeenCalledWith(`${CDN}/B.mkv`);
		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'no-store, no-cache, must-revalidate'
		);
	});

	// The URL-encoded basename is the only thing an explore listing carries, so
	// a stored path has to match on it.
	it('matches a stored path by its basename', async () => {
		mockExplore.mockResolvedValue([`${CDN}/Show.S01E02.mkv`]);
		await handler(
			createMockRequest({
				query: { userid: 'u', id: 'r1', file: 'Show.S01/Show.S01E02.mkv' },
			}),
			res
		);
		expect(res.redirect).toHaveBeenCalledWith(`${CDN}/Show.S01E02.mkv`);
	});

	// A library item is the viewer's own, so nothing is added and - crucially -
	// nothing is removed, unlike the cast play route. `cloud/remove` is a GET
	// that destroys state, and playing a file is not a reason to reach for it.
	it('adds and removes nothing', async () => {
		await handler(createMockRequest({ query: { userid: 'u', id: 'r1' } }), res);
		expect(res.redirect).toHaveBeenCalled();
		expect(vi.mocked(addOffcloudCloud)).not.toHaveBeenCalled();
		expect(vi.mocked(removeOffcloudCloud)).not.toHaveBeenCalled();
	});

	it('returns 400 when userid or id is missing', async () => {
		await handler(createMockRequest({ query: { userid: 'u' } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 500 when the user has no Offcloud profile', async () => {
		mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue(null);
		await handler(createMockRequest({ query: { userid: 'u', id: 'r1' } }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('returns 500 when the item holds no video', async () => {
		mockExplore.mockResolvedValue([`${CDN}/readme.txt`]);
		await handler(createMockRequest({ query: { userid: 'u', id: 'r1' } }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	// `cloud/explore` answers 404 "Request not found." for a removed item.
	it('returns 500 when explore refuses the request id', async () => {
		mockExplore.mockRejectedValue(new Error('Request not found.'));
		await handler(createMockRequest({ query: { userid: 'u', id: 'gone' } }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
