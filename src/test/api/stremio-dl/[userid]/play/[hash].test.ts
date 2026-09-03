import handler from '@/pages/api/stremio-dl/[userid]/play/[hash]';
import { addSeedboxTorrent, DebridLinkError, deleteSeedboxTorrents } from '@/services/debridLink';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/debridLink', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/debridLink')>('@/services/debridLink');
	return {
		...actual,
		addSeedboxTorrent: vi.fn(),
		deleteSeedboxTorrents: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockAdd = vi.mocked(addSeedboxTorrent);
const mockDelete = vi.mocked(deleteSeedboxTorrents);

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const SEED = 'https://seed41.debrid.link/dl';

const request = (query: Record<string, string> = {}) =>
	createMockRequest({ query: { userid: 'u', hash: HASH, ...query } });

const finishedTorrent = {
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
			downloadPercent: 100,
		},
		{
			id: 'f1',
			name: 'Show.S01/Show.S01E02.mkv',
			size: 100,
			downloadUrl: `${SEED}/tor-1-1/Show.S01E02.mkv`,
			downloadPercent: 100,
		},
	],
} as any;

describe('/api/stremio-dl/[userid]/play/[hash]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getDebridLinkCastProfile = vi
			.fn()
			.mockResolvedValue({ apiKey: 'viewer-token' });
		mockRepository.getDebridLinkStoredDownloadUrl = vi.fn().mockResolvedValue(null);
		mockAdd.mockResolvedValue(finishedTorrent);
	});

	it('returns 500 when the viewer has no profile', async () => {
		mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue(null);
		await handler(request(), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	// The whole point of the design: the link is resolved here with the
	// *viewer's* credential rather than redeemed out of the database.
	it('resolves with the viewer credential and the full magnet', async () => {
		await handler(request({ file: 'Show.S01/Show.S01E02.mkv' }), res);

		expect(mockAdd).toHaveBeenCalledWith('viewer-token', `magnet:?xt=urn:btih:${HASH}`);
		expect(res.redirect).toHaveBeenCalledWith(`${SEED}/tor-1-1/Show.S01E02.mkv`);
	});

	it('falls back to the biggest file when no path was stored', async () => {
		await handler(request(), res);
		expect(res.redirect).toHaveBeenCalledWith(`${SEED}/tor-1-0/Show.S01E01.mkv`);
	});

	// The add is idempotent by hash and Debrid-Link's remove never fails (it
	// echoes whatever id it was handed), so a cleanup here would silently delete
	// a seedbox item the viewer put there on purpose - with no error signal.
	it('never removes anything, whatever the outcome', async () => {
		await handler(request(), res);
		expect(mockDelete).not.toHaveBeenCalled();

		mockAdd.mockResolvedValue({ ...finishedTorrent, status: 4, downloadPercent: 12 });
		await handler(request(), createMockResponse());
		expect(mockDelete).not.toHaveBeenCalled();
	});

	// `status: 6` is VERIFICATION|DOWNLOADING - the vendor's own sample value,
	// equal to no single enum member. An equality test would read it as finished.
	it('reports an unfinished release with its percent rather than hanging', async () => {
		mockAdd.mockResolvedValue({ ...finishedTorrent, status: 6, downloadPercent: 42 });

		await handler(request(), res);

		expect(res.status).toHaveBeenCalledWith(504);
		expect(String((res._getData() as any).error)).toContain('42%');
		expect(res.redirect).not.toHaveBeenCalled();
	});

	// Debrid-Link URLs are keyless, IP-agnostic and survive deletion, so a stored
	// one plays for anybody - which is what makes it a real fallback when the
	// viewer's own credential cannot resolve the hash.
	it('serves the stored link when the viewer quota is spent', async () => {
		mockAdd.mockRejectedValue(new DebridLinkError('quota', 'maxTorrent'));
		mockRepository.getDebridLinkStoredDownloadUrl = vi
			.fn()
			.mockResolvedValue(`${SEED}/tor-1-1/Show.S01E02.mkv`);

		await handler(request({ file: 'Show.S01/Show.S01E02.mkv' }), res);

		expect(mockRepository.getDebridLinkStoredDownloadUrl).toHaveBeenCalledWith(
			HASH,
			'Show.S01/Show.S01E02.mkv'
		);
		expect(res.redirect).toHaveBeenCalledWith(`${SEED}/tor-1-1/Show.S01E02.mkv`);
	});

	it('serves the stored link when the endpoint is inside its flood lockout', async () => {
		mockAdd.mockRejectedValue(new DebridLinkError('locked', 'floodDetected'));
		mockRepository.getDebridLinkStoredDownloadUrl = vi
			.fn()
			.mockResolvedValue(`${SEED}/tor-1-0/Show.S01E01.mkv`);

		await handler(request(), res);

		expect(res.redirect).toHaveBeenCalledWith(`${SEED}/tor-1-0/Show.S01E01.mkv`);
	});

	// A release that is genuinely still downloading for this viewer may already
	// be playable through somebody else's stored link.
	it('prefers a stored link over reporting a download in progress', async () => {
		mockAdd.mockResolvedValue({ ...finishedTorrent, status: 4, downloadPercent: 3 });
		mockRepository.getDebridLinkStoredDownloadUrl = vi
			.fn()
			.mockResolvedValue(`${SEED}/tor-1-0/Show.S01E01.mkv`);

		await handler(request(), res);

		expect(res.redirect).toHaveBeenCalledWith(`${SEED}/tor-1-0/Show.S01E01.mkv`);
		expect(res.status).not.toHaveBeenCalledWith(504);
	});

	it('reports the Debrid-Link refusal in words when nothing is stored', async () => {
		mockAdd.mockRejectedValue(new DebridLinkError('raw', 'maxTorrent'));

		await handler(request(), res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(String((res._getData() as any).error)).toContain('50 per day');
	});

	it('errors rather than redirecting somewhere else when the file is gone', async () => {
		await handler(request({ file: 'Show.S09E99.mkv' }), res);
		expect(res.redirect).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('errors when the release holds no video at all', async () => {
		mockAdd.mockResolvedValue({
			...finishedTorrent,
			files: [{ id: 'f0', name: 'readme.txt', size: 5, downloadUrl: `${SEED}/tor-1-0/r` }],
		});

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
