import { identifyItems } from '@/pages/api/library/identify';
import handler, { MAX_FILES, MAX_RELEASES } from '@/pages/api/sponsor/place';
import { cachedSources, placeReleases, titled } from '@/services/placement';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import detectiveConan from '@/test/fixtures/metadata/tmdb-tv-30983-detective-conan.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
const recordMisses = vi.hoisted(() => vi.fn());
vi.mock('@/services/database/placementMisses', () => ({
	PlacementMissService: class {
		record = recordMisses;
	},
}));
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));
vi.mock('@/services/placement', () => ({
	placeReleases: vi.fn(),
	titled: vi.fn(async (release: object) => ({ ...release, title: 'Titled' })),
	cachedSources: { show: vi.fn(async () => null), find: vi.fn(async () => null) },
	PLACEMENT_RULES: '2026-10-23',
}));
vi.mock('@/pages/api/library/identify', () => ({
	identifyItems: vi.fn(),
	identificationItem: (filename: string, hash: string | null) => ({
		filename,
		hash,
		titleKey: 'k',
	}),
}));

const mockRepository = vi.mocked(repository);
const mockPlace = vi.mocked(placeReleases);
const mockIdentify = vi.mocked(identifyItems);

const sponsorKey = 'c'.repeat(64);
const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'PL4C',
	githubUsername: 'someone',
	keyVersion: 1,
};
const CONAN = {
	name: 'Detective.Conan.S33.1080p.WEB.H264-GRP',
	files: [{ path: 'Detective.Conan.S33E01.mkv', folder: '' }],
};

function post(body: unknown, headers: Record<string, string> = { 'x-api-key': sponsorKey }) {
	return createMockRequest({ method: 'POST', headers, body });
}

describe('/api/sponsor/place', () => {
	beforeEach(() => {
		mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
		mockPlace.mockResolvedValue({ releases: [], complete: true });
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
		recordMisses.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('answers each placed release with its title', async () => {
		const placed = { kind: 'tv' as const, imdbId: 'tt0131179', tmdbId: 30983, files: [] };
		mockPlace.mockResolvedValueOnce({ releases: [placed], complete: true });
		const res = createMockResponse();
		await handler(post({ releases: [CONAN] }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ releases: [{ ...placed, title: 'Titled' }], complete: true })
		);
	});

	// kept to improve the rules: what was asked, DMM's untitled answers, and the rules version
	it('records what it answered for the misses it keeps', async () => {
		const placed = { kind: null, imdbId: null, tmdbId: null, files: [] };
		mockPlace.mockResolvedValueOnce({ releases: [placed], complete: true });
		await handler(post({ releases: [CONAN] }), createMockResponse());

		expect(recordMisses).toHaveBeenCalledWith(
			[expect.objectContaining({ name: CONAN.name, hash: null, imdbId: null })],
			[placed],
			'2026-10-23'
		);
	});

	it('answers even when the misses cannot be written', async () => {
		recordMisses.mockRejectedValueOnce(new Error('database down'));
		vi.spyOn(console, 'error').mockImplementationOnce(() => {});
		const res = createMockResponse();
		await handler(post({ releases: [CONAN] }), res);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	// zurg files a show answered `anime` under `__anime__`: TMDB's captured record for Detective
	// Conan (Animation, ja, JP), read by the real `titled` as the route hands it DMM's sources
	it('answers whether a placed show is Japanese animation', async () => {
		const actual =
			await vi.importActual<typeof import('@/services/placement')>('@/services/placement');
		vi.mocked(titled).mockImplementationOnce(actual.titled);
		vi.mocked(cachedSources.show).mockResolvedValueOnce(detectiveConan);
		const placed = { kind: 'tv' as const, imdbId: 'tt0131179', tmdbId: 30983, files: [] };
		mockPlace.mockResolvedValueOnce({ releases: [placed], complete: true });
		const res = createMockResponse();
		await handler(post({ releases: [CONAN] }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				releases: [
					{ ...placed, title: 'Detective Conan', year: 1996, tvdbId: 72454, anime: true },
				],
			})
		);
	});

	it('hands the releases over as the contract names them, an empty imdbId as none', async () => {
		const res = createMockResponse();
		await handler(
			post({
				releases: [
					{ ...CONAN, imdbId: '', hash: 'A'.repeat(40) },
					{ name: 'Show', imdbId: 'tt0131179', files: [{ path: 'Show.S01E01.mkv' }] },
				],
			}),
			res
		);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockPlace.mock.calls[0][0]).toEqual([
			{ name: CONAN.name, hash: 'a'.repeat(40), imdbId: null, files: CONAN.files },
			{
				name: 'Show',
				hash: null,
				imdbId: 'tt0131179',
				// no folder: unknown, which the parser keeps apart from the top of a release
				files: [{ path: 'Show.S01E01.mkv', folder: null }],
			},
		]);
	});

	// an older zurg that does not read `part` would file a second part as a copy of the episode
	it('hands `parts` over on every release and answers every file with its part', async () => {
		const file = (part?: number) => ({
			path: 'Lost.S04E14.mkv',
			season: 4,
			episode: 13,
			episodeEnd: null,
			how: 'aligned' as const,
			tmdbEpisodeId: 334007,
			...(part ? { part } : {}),
		});
		const placed = { kind: 'tv' as const, imdbId: 'tt0411008', tmdbId: 4607 };
		mockPlace.mockResolvedValueOnce({
			releases: [{ ...placed, files: [file(), file(2)] }],
			complete: true,
		});
		const res = createMockResponse();
		await handler(post({ releases: [CONAN], parts: true }), res);

		expect(mockPlace.mock.calls[0][0]).toEqual([
			{ name: CONAN.name, hash: null, imdbId: null, files: CONAN.files, parts: true },
		]);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				releases: [
					{ ...placed, title: 'Titled', files: [{ ...file(), part: null }, file(2)] },
				],
			})
		);
	});

	it('answers without `part` where the request does not ask for parts', async () => {
		mockPlace.mockResolvedValueOnce({
			releases: [{ kind: null, imdbId: null, tmdbId: null, files: [] }],
			complete: true,
		});
		const res = createMockResponse();
		await handler(post({ releases: [CONAN], parts: false }), res);

		expect(mockPlace.mock.calls[0][0][0]).not.toHaveProperty('parts');
	});

	// an older zurg that does not read a file's own show would file it as the release's episode
	it('hands `shows` over on every release that asks for it', async () => {
		const res = createMockResponse();
		await handler(post({ releases: [CONAN], shows: true }), res);
		expect(mockPlace.mock.calls[0][0]).toEqual([
			{ name: CONAN.name, hash: null, imdbId: null, files: CONAN.files, shows: true },
		]);

		await handler(post({ releases: [CONAN] }), createMockResponse());
		expect(mockPlace.mock.calls[1][0][0]).not.toHaveProperty('shows');
	});

	// zurg keeps a placement until it asks again a day or a week on, so a fix to the rules
	// reached rex-fun's releases only that much later (2026-10-22); a caller holding answers
	// from older rules asks about them again
	it('names the rules its answer was placed by', async () => {
		const res = createMockResponse();
		await handler(post({ releases: [CONAN] }), res);

		expect(res.json).toHaveBeenCalledWith({
			releases: [],
			complete: true,
			rules: '2026-10-23',
		});
	});

	it('answers a name the identifier could not be asked about as unknown, to be asked again', async () => {
		const res = createMockResponse();
		await handler(post({ releases: [CONAN] }), res);
		const identify = mockPlace.mock.calls[0][1];

		mockIdentify.mockResolvedValueOnce({ results: [null], complete: false });
		expect(await identify([{ name: CONAN.name, hash: null }])).toEqual([undefined]);
		mockIdentify.mockResolvedValueOnce({ results: [null], complete: true });
		expect(await identify([{ name: CONAN.name, hash: null }])).toEqual([null]);
	});

	it.each([
		['no releases', { releases: [] }],
		['too many releases', { releases: Array(MAX_RELEASES + 1).fill(CONAN) }],
		[
			'too many files',
			{
				releases: [
					{
						name: 'Pack',
						files: Array(MAX_FILES + 1).fill({ path: 'a.mkv', folder: '' }),
					},
				],
			},
		],
		['a release without files', { releases: [{ name: 'Pack' }] }],
		['a file without a path', { releases: [{ name: 'Pack', files: [{ folder: '' }] }] }],
		['a numeric imdbId', { releases: [{ ...CONAN, imdbId: 131179 }] }],
		['parts that is no boolean', { releases: [CONAN], parts: 'yes' }],
		['shows that is no boolean', { releases: [CONAN], shows: 1 }],
	])('refuses %s', async (_, body) => {
		const res = createMockResponse();
		await handler(post(body), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockPlace).not.toHaveBeenCalled();
	});

	it('budgets each sponsorship 60 calls a minute wherever it calls from', async () => {
		vi.mocked(checkRateLimitFor).mockResolvedValueOnce(false);
		const res = createMockResponse();
		await handler(post({ releases: [CONAN] }), res);

		expect(res.status).toHaveBeenCalledWith(429);
		expect(vi.mocked(checkRateLimitFor).mock.calls[0].slice(0, 2)).toEqual([
			'sponsor:PL4C',
			RATE_LIMIT_CONFIGS.sponsorPlace,
		]);
		// 100 releases a call: a 10,000-release library backfills in under two minutes
		expect(RATE_LIMIT_CONFIGS.sponsorPlace).toMatchObject({ rateLimit: 60, windowSeconds: 60 });
		expect(mockPlace).not.toHaveBeenCalled();
	});

	it('requires a DMM API key', async () => {
		const res = createMockResponse();
		await handler(post({ releases: [CONAN] }, {}), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockPlace).not.toHaveBeenCalled();
	});

	it("refuses a lapsed sponsor's key", async () => {
		mockRepository.getSponsorByDmmApiKey = vi
			.fn()
			.mockResolvedValue({ ...ACTIVE, isSponsor: false, sources: [] });
		const res = createMockResponse();
		await handler(post({ releases: [CONAN] }), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockPlace).not.toHaveBeenCalled();
	});

	it('answers only POST', async () => {
		const res = createMockResponse();
		await handler(
			createMockRequest({ method: 'GET', headers: { 'x-api-key': sponsorKey } }),
			res
		);

		expect(res.status).toHaveBeenCalledWith(405);
	});
});
