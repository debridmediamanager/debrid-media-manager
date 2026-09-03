import { repository as db } from '@/services/repository';
import {
	registerCompletedDebridJob,
	registerCompletedNzb2rdJob,
} from '@/services/transferRegistration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/nzb2rd', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/nzb2rd')>()),
	addHashToRdAccount: vi.fn().mockResolvedValue(undefined),
}));

const mockDb = vi.mocked(db);

const HASH = 'd'.repeat(40);

const completedJob = (over?: Record<string, unknown>) => ({
	id: 'job-1',
	status: 'completed',
	info_hash: HASH,
	imdb_id: 'tt0190641',
	name: 'Pokemon.The.First.Movie.Mewtwo.Strikes.Back.1998.BluRay.1080p.AVC.REMUX-GRP',
	completed_at: '2026-08-28T07:49:19.000Z',
	files: [
		{
			name: 'Pokemon.The.First.Movie.Mewtwo.Strikes.Back.1998.BluRay.1080p.AVC.REMUX-GRP.mkv',
			size: 19_046_597_500,
			rd_link: 'https://real-debrid.com/d/JMMWHJYVBAYMS',
		},
	],
	...over,
});

/** What `xfer:nzb2rd:<jobId>` holds for this job, if anything. */
const metaSays = (returnPath?: string) => {
	mockDb.getTransferMeta = vi
		.fn()
		.mockResolvedValue(
			returnPath
				? new Map([['nzb2rd:job-1', { source: 'nzb2rd', jobId: 'job-1', returnPath }]])
				: new Map()
		);
};

beforeEach(() => {
	vi.clearAllMocks();
	mockDb.recordNzb2rdTransferCompleted = vi.fn().mockResolvedValue(undefined);
	mockDb.takeNzb2rdWaiters = vi.fn().mockResolvedValue([]);
	mockDb.checkAvailabilityByHashes = vi.fn().mockResolvedValue([]);
	mockDb.saveScrapedTrueResults = vi.fn().mockResolvedValue(undefined);
	mockDb.upsertAvailability = vi.fn().mockResolvedValue(undefined);
	mockDb.getImdbTitleType = vi.fn().mockResolvedValue(null);
	metaSays(undefined);
});

// A completed release that is only recorded as a marker shows "In RD" on the
// Usenet row while existing in no search result anywhere — the marker is what
// the button reads, and `ScrapedTrue`/`Available` are what the page reads.
// Measured 2026-08-29: 991 of 1128 completed markers were in exactly that state,
// because the two callers that promote a marker without a browser attached
// passed no context and the filing was gated on it.
describe('registerCompletedNzb2rdJob — filing the release into search', () => {
	it('files a movie under the context the caller passes', async () => {
		expect(await registerCompletedNzb2rdJob(completedJob(), 'movie', undefined, 'rel-1')).toBe(
			true
		);

		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'movie:tt0190641',
			[expect.objectContaining({ hash: HASH })],
			true
		);
		expect(mockDb.upsertAvailability).toHaveBeenCalledWith(
			expect.objectContaining({ hash: HASH, imdbId: 'tt0190641', status: 'downloaded' })
		);
	});

	// The regression. `/api/nzb2rd/registered` and the marker sweep both promote a
	// marker with no page context, and used to stop at the marker.
	it('falls back to the stored returnPath when the caller passes no context', async () => {
		metaSays('/movie/tt0190641');

		expect(
			await registerCompletedNzb2rdJob(completedJob(), undefined, undefined, 'rel-1')
		).toBe(true);

		expect(mockDb.getTransferMeta).toHaveBeenCalledWith([{ source: 'nzb2rd', jobId: 'job-1' }]);
		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'movie:tt0190641',
			[expect.objectContaining({ hash: HASH })],
			true
		);
	});

	it('reads the season out of a stored show returnPath', async () => {
		metaSays('/show/tt0190641/3');

		expect(
			await registerCompletedNzb2rdJob(completedJob(), undefined, undefined, 'rel-1')
		).toBe(true);

		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'tv:tt0190641:3',
			expect.anything(),
			true
		);
	});

	// An *arr pushing into nzb2rd's SABnzbd API, or rd-uploader, never stores a
	// returnPath — so a third source is needed or those releases stay invisible
	// no matter how the marker paths are fixed.
	it('derives a movie context from the IMDb title type when nothing is stored', async () => {
		mockDb.getImdbTitleType = vi.fn().mockResolvedValue('movie');

		expect(
			await registerCompletedNzb2rdJob(completedJob(), undefined, undefined, 'rel-1')
		).toBe(true);

		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'movie:tt0190641',
			expect.anything(),
			true
		);
	});

	it('derives a show season from the release name when nothing is stored', async () => {
		mockDb.getImdbTitleType = vi.fn().mockResolvedValue('tvSeries');

		expect(
			await registerCompletedNzb2rdJob(
				completedJob({ name: 'The.Traitors.NZ.S03E01.1080p.AMZN.WEB.DL.DDP2.0.H.264-GRP' }),
				undefined,
				undefined,
				'rel-1'
			)
		).toBe(true);

		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'tv:tt0190641:3',
			expect.anything(),
			true
		);
	});

	// Validated against 697 completed releases whose stored returnPath was known:
	// deriving from the name agreed on 682 and never picked the wrong media type,
	// but disagreed on the season 3 times — DMM's season numbering is not always
	// the release's. The page the user was actually on wins.
	it('prefers a stored returnPath over what the release name says', async () => {
		metaSays('/show/tt0190641/3');
		mockDb.getImdbTitleType = vi.fn().mockResolvedValue('tvSeries');

		await registerCompletedNzb2rdJob(
			completedJob({ name: 'Conan.OBrien.Must.Go.S01.1080p.WEB.H264-GRP' }),
			undefined,
			undefined,
			'rel-1'
		);

		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'tv:tt0190641:3',
			expect.anything(),
			true
		);
		expect(mockDb.getImdbTitleType).not.toHaveBeenCalled();
	});

	// The marker and the waiter delivery are worth recording even for a release
	// that can be filed nowhere — they stop a second Usenet fetch either way.
	it('still records the marker when no context can be resolved at all', async () => {
		mockDb.getImdbTitleType = vi.fn().mockResolvedValue('tvEpisode');

		expect(
			await registerCompletedNzb2rdJob(completedJob(), undefined, undefined, 'rel-1')
		).toBe(false);

		expect(mockDb.recordNzb2rdTransferCompleted).toHaveBeenCalledWith(
			'rel-1',
			'job-1',
			'tt0190641',
			HASH,
			expect.any(String)
		);
		expect(mockDb.saveScrapedTrueResults).not.toHaveBeenCalled();
	});

	it('does not re-file a hash that is already available', async () => {
		metaSays('/movie/tt0190641');
		mockDb.checkAvailabilityByHashes = vi.fn().mockResolvedValue([{ hash: HASH }]);

		expect(
			await registerCompletedNzb2rdJob(completedJob(), undefined, undefined, 'rel-1')
		).toBe(false);

		expect(mockDb.saveScrapedTrueResults).not.toHaveBeenCalled();
	});

	// Resolution costs two lookups; neither is worth doing for a job that cannot
	// produce a registration in the first place.
	it('does nothing for a job with no usable info hash', async () => {
		expect(
			await registerCompletedNzb2rdJob(
				completedJob({ info_hash: 'nope' }),
				'movie',
				undefined,
				'rel-1'
			)
		).toBe(false);

		expect(mockDb.recordNzb2rdTransferCompleted).not.toHaveBeenCalled();
		expect(mockDb.getTransferMeta).not.toHaveBeenCalled();
	});
});

// The TB → RD path had the same defect the Usenet one above was fixed for, and
// the same consequence: the only callers that ever supplied a context were a
// live movie or show page, so a transfer whose submitter closed the tab — or one
// swept up server-side, which by construction has no page — was filed nowhere.
// Measured on production 2026-09-03: 75 of 310 completed mappings were in no
// search blob, and a further 344 completed jobs had never been recorded at all.
describe('registerCompletedDebridJob — filing a TB → RD transfer into search', () => {
	const REWRITTEN = 'a'.repeat(40);
	const ORIGINAL = 'b'.repeat(40);
	const SERVER = 'http://uploader:3100';

	const debridJob = (over?: Record<string, unknown>) => ({
		id: 'job-9',
		status: 'completed',
		info_hash: REWRITTEN,
		input: `magnet:?xt=urn:btih:${ORIGINAL}`,
		imdb_id: 'tt0190641',
		name: 'Pokemon.The.First.Movie.1998.BluRay.1080p.AVC.REMUX-GRP',
		completed_at: '2026-09-01T07:49:19.000Z',
		...over,
	});

	/** What `xfer:debrid:<jobId>` holds for this job, if anything. */
	const debridMetaSays = (returnPath?: string) => {
		mockDb.getTransferMeta = vi
			.fn()
			.mockResolvedValue(
				returnPath
					? new Map([['debrid:job-9', { source: 'debrid', jobId: 'job-9', returnPath }]])
					: new Map()
			);
	};

	beforeEach(() => {
		mockDb.recordDebridTransferCompleted = vi.fn().mockResolvedValue(undefined);
		debridMetaSays(undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => [
					{
						name: 'Pokemon.The.First.Movie.1998.BluRay.1080p.AVC.REMUX-GRP.mkv',
						size: 19_046_597_500,
						rd_link: 'https://real-debrid.com/d/JMMWHJYVBAYMS',
					},
				],
			})
		);
	});

	it('files a movie under the context the caller passes', async () => {
		expect(await registerCompletedDebridJob(debridJob(), 'movie', undefined, SERVER)).toBe(
			true
		);

		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'movie:tt0190641',
			[expect.objectContaining({ hash: REWRITTEN })],
			true
		);
	});

	// The regression. The reconciliation sweep runs with no page attached, and
	// this used to stop at the mapping.
	it('falls back to the stored returnPath when the caller passes no context', async () => {
		debridMetaSays('/show/tt0190641/2');

		expect(await registerCompletedDebridJob(debridJob(), undefined, undefined, SERVER)).toBe(
			true
		);

		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'tv:tt0190641:2',
			[expect.objectContaining({ hash: REWRITTEN })],
			true
		);
	});

	// Third tier: a job with neither a caller context nor a stored path is still
	// filable from what DMM knows about the IMDb id.
	it('falls back to the IMDb title type and the season in the release name', async () => {
		mockDb.getImdbTitleType = vi.fn().mockResolvedValue('tvSeries');

		expect(
			await registerCompletedDebridJob(
				debridJob({ name: 'Pokemon.S03.1080p.BluRay.AVC.REMUX-GRP' }),
				undefined,
				undefined,
				SERVER
			)
		).toBe(true);

		expect(mockDb.saveScrapedTrueResults).toHaveBeenCalledWith(
			'tv:tt0190641:3',
			[expect.objectContaining({ hash: REWRITTEN })],
			true
		);
	});

	// The mapping is written before the filing is even attempted: a title with
	// nowhere to be filed must still stop blocking every later submitter of that
	// original hash, which is what a mapping stuck on `pending` does.
	it('records the mapping even when the release can be filed nowhere', async () => {
		expect(await registerCompletedDebridJob(debridJob(), undefined, undefined, SERVER)).toBe(
			false
		);

		expect(mockDb.recordDebridTransferCompleted).toHaveBeenCalledWith(
			ORIGINAL,
			'job-9',
			'tt0190641',
			REWRITTEN
		);
		expect(mockDb.saveScrapedTrueResults).not.toHaveBeenCalled();
	});
});
