import { identifyItems } from '@/pages/api/library/identify';
import handler, { MAX_FILES, MAX_RELEASES } from '@/pages/api/sponsor/place';
import { placeReleases } from '@/services/placement';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));
vi.mock('@/services/placement', () => ({
	placeReleases: vi.fn(),
	titled: vi.fn(async (release: object) => ({ ...release, title: 'Titled' })),
	cachedSources: {},
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
