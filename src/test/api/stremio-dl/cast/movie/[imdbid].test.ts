import handler from '@/pages/api/stremio-dl/cast/movie/[imdbid]';
import { DebridLinkError } from '@/services/debridLink';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	describeDebridLinkError,
	generateDebridLinkUserId,
	resolveDebridLinkRelease,
} from '@/utils/debridLinkCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/debridLinkCastApiHelpers', async () => {
	const actual = await vi.importActual<typeof import('@/utils/debridLinkCastApiHelpers')>(
		'@/utils/debridLinkCastApiHelpers'
	);
	return {
		...actual,
		generateDebridLinkUserId: vi.fn(),
		resolveDebridLinkRelease: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockResolve = vi.mocked(resolveDebridLinkRelease);

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const SEED = 'https://seed41.debrid.link/dl';

const file = (path: string, size: number, link: string | null = null) => ({
	path,
	filename: path.split('/').pop()!,
	size,
	link,
	percent: 100,
});

const release = (files: ReturnType<typeof file>[], over: Record<string, unknown> = {}) =>
	({
		torrent: { id: 'tor-1', name: 'Release', status: 100 },
		files,
		finished: true,
		percent: 100,
		...over,
	}) as any;

const call = (res: ReturnType<typeof createMockResponse>) =>
	handler(
		createMockRequest({
			query: { imdbid: 'tt123', hash: HASH },
			headers: { authorization: 'Bearer dl-token' },
		}),
		res
	);

describe('/api/stremio-dl/cast/movie/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generateDebridLinkUserId).mockResolvedValue('dl-user-1');
		mockRepository.saveDebridLinkCast = vi.fn().mockResolvedValue(undefined);
	});

	it('rejects a request with no credential', async () => {
		await handler(createMockRequest({ query: { imdbid: 'tt123', hash: HASH } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	// Debrid-Link accepts `?access_token=` upstream, which is a live log-leak
	// path, so the credential must never reach a URL.
	it('takes the credential from the Authorization header', async () => {
		mockResolve.mockResolvedValue(release([file('Movie/Movie.mkv', 90_000_000)]));

		await call(res);

		expect(mockResolve).toHaveBeenCalledWith('dl-token', HASH);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('stores the feature, not whatever Debrid-Link listed first', async () => {
		mockResolve.mockResolvedValue(
			release([
				file('Movie/Movie.2019.mkv', 276_134_947, `${SEED}/tor-1-0/Movie.2019.mkv`),
				file('Movie/Movie.Featurette.mkv', 310_380, `${SEED}/tor-1-1/f.mkv`),
			])
		);

		await call(res);

		expect(mockRepository.saveDebridLinkCast).toHaveBeenCalledWith(
			'tt123',
			'dl-user-1',
			HASH,
			'Movie.2019.mkv',
			263,
			'Movie/Movie.2019.mkv',
			`${SEED}/tor-1-0/Movie.2019.mkv`
		);
	});

	// Unlike every sibling table, this one keeps the URL: a Debrid-Link link is
	// keyless, IP-agnostic and survives deletion, so it is a real fallback for a
	// viewer whose own credential cannot resolve the hash.
	it('stores the keyless URL as the play-time fallback', async () => {
		mockResolve.mockResolvedValue(
			release([file('Movie.mkv', 100, `${SEED}/tor-1-0/Movie.mkv`)])
		);

		await call(res);

		expect(mockRepository.saveDebridLinkCast.mock.calls[0][6]).toBe(
			`${SEED}/tor-1-0/Movie.mkv`
		);
	});

	// No cheap wait exists - the only poll is another request against an endpoint
	// whose punishment for a loop is an hour - so this reports and stops.
	it('reports a release still downloading, with its percent', async () => {
		mockResolve.mockResolvedValue(
			release([file('Movie.mkv', 100)], { finished: false, percent: 37 })
		);

		await call(res);

		expect(res.status).toHaveBeenCalledWith(409);
		expect(String((res._getData() as any).errorMessage)).toContain('37%');
		expect(mockRepository.saveDebridLinkCast).not.toHaveBeenCalled();
	});

	it('reports a release with no video in it', async () => {
		mockResolve.mockResolvedValue(release([]));

		await call(res);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(mockRepository.saveDebridLinkCast).not.toHaveBeenCalled();
	});

	// A cast that costs one of 50 daily torrents has to say so when it is refused
	// for exactly that reason.
	it('spells out a quota refusal rather than reporting a generic failure', async () => {
		mockResolve.mockRejectedValue(new DebridLinkError('raw', 'maxTorrent'));

		await call(res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect((res._getData() as any).errorMessage).toBe(
			describeDebridLinkError(new DebridLinkError('raw', 'maxTorrent'))
		);
		expect(String((res._getData() as any).errorMessage)).toContain('50 per day');
	});

	it('spells out an hour-long flood lockout', async () => {
		mockResolve.mockRejectedValue(new DebridLinkError('raw', 'floodDetected'));

		await call(res);

		expect(String((res._getData() as any).errorMessage)).toContain('an hour');
	});
});
