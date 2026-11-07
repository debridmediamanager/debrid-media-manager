import odyssey from '@/test/fixtures/aiostreams/odyssey-2026-11-07.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIOSTREAMS_TTL_MS, enrichFromAioStreams } from './aioStreamsEnrich';

const { getRefreshedAt, markRefreshed, titleType, titleById, saveTrue, cinemeta } = vi.hoisted(
	() => ({
		getRefreshedAt: vi.fn(),
		markRefreshed: vi.fn(),
		titleType: vi.fn(),
		titleById: vi.fn(),
		saveTrue: vi.fn(),
		cinemeta: vi.fn(),
	})
);

vi.mock('@/services/repository', () => ({
	repository: {
		getRefreshedAt,
		markRefreshed,
		getImdbTitleType: titleType,
		getImdbTitleById: titleById,
		saveScrapedTrueResults: saveTrue,
	},
}));
vi.mock('@/services/metadataCache', () => ({
	getMetadataCache: () => ({ getCinemetaSeries: cinemeta }),
}));

const BASE = 'https://aio.example/stremio/uuid/pw';
const ODYSSEY = { imdbId: 'tt33764258', key: 'movie:tt33764258', kind: 'movie' as const };
const fetchMock = vi.fn();

beforeEach(() => {
	vi.stubEnv('AIOSTREAMS_URL', BASE);
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => odyssey });
	getRefreshedAt.mockReset().mockResolvedValue(null);
	markRefreshed.mockReset().mockResolvedValue(undefined);
	saveTrue.mockReset().mockResolvedValue(undefined);
	titleType.mockReset().mockResolvedValue('movie');
	titleById.mockReset().mockResolvedValue({
		imdbId: 'tt33764258',
		title: 'The Odyssey',
		originalTitle: 'The Odyssey',
		year: 2026,
	});
	cinemeta.mockReset();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

const savedTitles = () => (saveTrue.mock.calls[0][1] as { title: string }[]).map((r) => r.title);
const savedHashes = () => (saveTrue.mock.calls[0][1] as { hash: string }[]).map((r) => r.hash);

describe('enrichFromAioStreams', () => {
	it("merges a film's AIOStreams releases into its page", async () => {
		await enrichFromAioStreams(ODYSSEY);

		expect(fetchMock).toHaveBeenCalledWith(
			`${BASE}/stream/movie/tt33764258.json`,
			expect.anything()
		);
		expect(saveTrue).toHaveBeenCalledWith('movie:tt33764258', expect.any(Array), true);
		// The four TorBox-cached remuxes no other DMM source had.
		expect(savedHashes()).toEqual(
			expect.arrayContaining([
				'601aff1ef7c1d7023a61ba49d283bc74728ad3f6',
				'31accef5eda5c473f5c22f1d6f1d9be7a98d8efb',
				'e6eba29dfb6e11190212e055eac1869c28ef048e',
				'864a36e5254aeb0db48e9c5ea45e3268c49d115f',
			])
		);
	});

	it("holds name-searched releases to DMM's scraper checks", async () => {
		await enrichFromAioStreams(ODYSSEY);

		expect(savedTitles()).toContain('The.Odyssey.2026.1080p.WEBRip.x265-INFINITY.mp4');
		for (const junk of [
			'[2026.08.21] VA - Pure Space Odyssey, Vol. 1', // another title
			'The Odyssey XXX Part 1 [Cosplayground 2026] XXX WEB-DL 2160p MP4-P2P [XC]', // banned words
			'The Odyssey (2026) Official Teaser Trailer 4K.mkv', // 345 MB, under the film floor
		]) {
			expect(savedTitles()).not.toContain(junk);
		}
	});

	it('asks at most once a day per page', async () => {
		getRefreshedAt.mockResolvedValue(new Date(Date.now() - AIOSTREAMS_TTL_MS + 60_000));
		await enrichFromAioStreams(ODYSSEY);
		expect(fetchMock).not.toHaveBeenCalled();

		getRefreshedAt.mockResolvedValue(new Date(Date.now() - AIOSTREAMS_TTL_MS - 60_000));
		await enrichFromAioStreams(ODYSSEY);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('stamps before it asks, so concurrent replicas send one request', async () => {
		let stampedFirst = false;
		fetchMock.mockImplementation(async () => {
			stampedFirst = markRefreshed.mock.calls.length > 0;
			return { ok: true, json: async () => odyssey };
		});
		await enrichFromAioStreams(ODYSSEY);
		expect(markRefreshed).toHaveBeenCalledWith('aiostreams:refresh:movie:tt33764258');
		expect(stampedFirst).toBe(true);
	});

	it('asks for the one episode a Stremio request wanted, stamped per episode', async () => {
		titleType.mockResolvedValue('tvSeries');
		await enrichFromAioStreams({
			imdbId: 'tt0903747',
			key: 'tv:tt0903747:2',
			kind: 'series',
			season: 2,
			episode: 5,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			`${BASE}/stream/series/tt0903747:2:5.json`,
			expect.anything()
		);
		expect(markRefreshed).toHaveBeenCalledWith('aiostreams:refresh:tv:tt0903747:2:5');
		expect(cinemeta).not.toHaveBeenCalled();
	});

	it('does nothing when unconfigured', async () => {
		vi.stubEnv('AIOSTREAMS_URL', '');
		expect(await enrichFromAioStreams(ODYSSEY)).toBe(0);
		expect(getRefreshedAt).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('leaves an id of the other kind alone', async () => {
		titleType.mockResolvedValue('tvSeries');
		await enrichFromAioStreams(ODYSSEY);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(saveTrue).not.toHaveBeenCalled();
	});
});
