import handler from '@/pages/api/stremio-dl/[userid]/play/item/[id]';
import { addSeedboxTorrent, getSeedboxTorrent } from '@/services/debridLink';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/debridLink', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/debridLink')>('@/services/debridLink');
	return { ...actual, getSeedboxTorrent: vi.fn(), addSeedboxTorrent: vi.fn() };
});

const mockRepository = vi.mocked(repository);
const mockById = vi.mocked(getSeedboxTorrent);
const mockAdd = vi.mocked(addSeedboxTorrent);

const SEED = 'https://seed41.debrid.link/dl';

const request = (query: Record<string, string> = {}) =>
	createMockRequest({ query: { userid: 'u', id: 'tor-1', ...query } });

describe('/api/stremio-dl/[userid]/play/item/[id]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue({ apiKey: 'dl-token' });
		mockById.mockResolvedValue({
			id: 'tor-1',
			name: 'Show.S01',
			status: 100,
			downloadPercent: 100,
			files: [
				{
					id: 'f0',
					name: 'Show.S01/Show.S01E01.mkv',
					size: 500,
					downloadUrl: `${SEED}/tor-1-0/Show.S01E01.mkv`,
				},
				{
					id: 'f1',
					name: 'Show.S01/Show.S01E02.mkv',
					size: 100,
					downloadUrl: `${SEED}/tor-1-1/Show.S01E02.mkv`,
				},
			],
		} as any);
	});

	it('returns 500 when the viewer has no profile', async () => {
		mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue(null);
		await handler(request(), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('redirects to the requested file', async () => {
		await handler(request({ file: 'Show.S01/Show.S01E02.mkv' }), res);
		expect(res.redirect).toHaveBeenCalledWith(`${SEED}/tor-1-1/Show.S01E02.mkv`);
	});

	// A library entry already lives in the account, so this path must never add
	// anything - an add would spend one of the day's 50 torrents for a file the
	// user already has.
	it('spends no quota: it lists, it never adds', async () => {
		await handler(request(), res);
		expect(mockById).toHaveBeenCalledWith('dl-token', 'tor-1');
		expect(mockAdd).not.toHaveBeenCalled();
	});

	it('falls back to the biggest file when none was named', async () => {
		await handler(request(), res);
		expect(res.redirect).toHaveBeenCalledWith(`${SEED}/tor-1-0/Show.S01E01.mkv`);
	});

	// An id Debrid-Link does not recognise makes the `ids` filter vanish and the
	// entire account come back; the client-side match in the service turns that
	// into "no such torrent", which must not become a redirect somewhere else.
	it('errors on an id this account does not hold', async () => {
		mockById.mockResolvedValue(null);
		await handler(request(), res);
		expect(res.redirect).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('errors when the file is not in the item', async () => {
		await handler(request({ file: 'Show.S09E99.mkv' }), res);
		expect(res.redirect).not.toHaveBeenCalled();
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
