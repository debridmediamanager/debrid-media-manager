import { repository as db } from '@/services/repository';
import {
	completedJobsIn,
	fileCompletedTransfers,
	LOOKBACK_MS,
	REFUSED_RETRY_MS,
} from '@/services/transferFilingSweep';
import {
	DEBRID,
	DEBRID_TICK,
	NZB2RD,
	NZB2RD_TICK,
	recorded,
	recordedJob,
	transferWorld,
} from '@/test/utils/transferFilingWorld';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

// Driven by the jobs nzb2rd and debrid02 listed on 2026-10-03; see
// `src/test/fixtures/transfers/README.md` for what each one is.

let world: ReturnType<typeof transferWorld>;

const HOUR = 60 * 60 * 1000;
const at = (base: Date, plusMs = 0) => base.getTime() + plusMs;
const hashOf = (id: string) => recordedJob(id).info_hash.toLowerCase();
const detailFetches = () => world.requests.filter((u) => /\/jobs\/[^/]+(\/files)?$/.test(u));

beforeEach(() => {
	vi.clearAllMocks();
	process.env.NZB2RD_URL = NZB2RD;
	process.env.DEBRID_UPLOADER_URLS = DEBRID;
	world = transferWorld();
	Object.assign(db, world.repo);
	vi.stubGlobal('fetch', world.fetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fileCompletedTransfers', () => {
	it('asks about a job once: the next tick fetches nothing per job and writes nothing', async () => {
		const first = await fileCompletedTransfers({ now: at(NZB2RD_TICK) });
		expect(first).toMatchObject({ filed: 3, refused: 1, errors: 0 });

		world.requests.length = 0;
		vi.clearAllMocks();
		const second = await fileCompletedTransfers({ now: at(NZB2RD_TICK, 5 * 60 * 1000) });

		expect(second).toMatchObject({ due: 0, filed: 0, refused: 0 });
		expect(detailFetches()).toEqual([]);
		expect(world.repo.fileTransferRelease).not.toHaveBeenCalled();
		expect(world.repo.recordNzb2rdTransferCompleted).not.toHaveBeenCalled();
	});

	// `/api/availability/remove` deletes a row a user found was not really
	// cached. Refiling it every five minutes would undo that report forever.
	it('does not refile a release a user evicted from search after it was filed', async () => {
		await fileCompletedTransfers({ now: at(NZB2RD_TICK) });
		world.evict(hashOf('nzb2rd-A1'));
		vi.clearAllMocks();

		await fileCompletedTransfers({ now: at(NZB2RD_TICK, HOUR) });

		expect(world.repo.fileTransferRelease).not.toHaveBeenCalled();
		expect(world.available.has(hashOf('nzb2rd-A1'))).toBe(false);
	});

	// A title newer than the last IMDb import has no title type, so no page to
	// file under, until the next daily import. That refusal heals.
	it('asks about a refusal again only after REFUSED_RETRY_MS', async () => {
		const now = at(NZB2RD_TICK);
		await fileCompletedTransfers({ now });
		const record = world.filings.get('nzb2rd:nzb2rd-E')!;
		expect(record.outcome).toBe('refused');

		// E leaves the window six hours after this tick, so the record is aged
		// instead of the clock.
		world.requests.length = 0;
		record.at = now - REFUSED_RETRY_MS + 1;
		await fileCompletedTransfers({ now });
		expect(world.requests).not.toContain(`${NZB2RD}/jobs/nzb2rd-E`);

		record.at = now - REFUSED_RETRY_MS;
		await fileCompletedTransfers({ now });
		expect(world.requests).toContain(`${NZB2RD}/jobs/nzb2rd-E`);
	});

	it('files newest first and leaves the rest of a full batch for the next tick', async () => {
		const result = await fileCompletedTransfers({ now: at(NZB2RD_TICK), batch: 1 });

		expect(result).toMatchObject({ due: 4, filed: 1, deferred: 3 });
		// B1 completed at 21:29:58, the latest of the four.
		expect(world.filedHashes()).toEqual([hashOf('nzb2rd-B1')]);
	});

	it('files nothing completed before the window, which is the backfill’s', async () => {
		// G completed 2026-09-26 19:08:02. Move the tick so it sits just inside,
		// then just outside.
		const g = Date.parse(`${recordedJob('nzb2rd-G').completed_at.replace(' ', 'T')}Z`);

		await fileCompletedTransfers({ now: g + LOOKBACK_MS });
		expect(world.filedHashes()).toContain(hashOf('nzb2rd-G'));

		world = transferWorld();
		Object.assign(db, world.repo);
		vi.stubGlobal('fetch', world.fetch);
		await fileCompletedTransfers({ now: g + LOOKBACK_MS + 1000 });
		expect(world.filedHashes()).not.toContain(hashOf('nzb2rd-G'));
	});

	it('still files from one service while the other cannot be listed', async () => {
		const recordedFetch = world.fetch.getMockImplementation()!;
		world.fetch.mockImplementation(async (url: string | URL) => {
			if (String(url) === `${NZB2RD}/jobs`) throw new Error('connection refused');
			return recordedFetch(url);
		});

		const result = await fileCompletedTransfers({ now: at(DEBRID_TICK) });

		expect(result).toMatchObject({ unreachable: 1, filed: 2 });
		expect(world.filedHashes().sort()).toEqual(
			[hashOf('debrid-D1'), hashOf('debrid-D2')].sort()
		);
	});

	// No answer is not an answer: writing a record would stop the job being
	// asked about until the refusal retry, for a job that may well file.
	it('records nothing for a job nzb2rd could not answer about, and retries it next tick', async () => {
		const recordedFetch = world.fetch.getMockImplementation()!;
		world.fetch.mockImplementation(async (url: string | URL) => {
			if (String(url) === `${NZB2RD}/jobs/nzb2rd-B1`) {
				return { ok: false, status: 502, json: async () => ({}) } as any;
			}
			return recordedFetch(url);
		});

		const result = await fileCompletedTransfers({ now: at(NZB2RD_TICK) });
		expect(result.errors).toBe(1);
		expect(world.filings.has('nzb2rd:nzb2rd-B1')).toBe(false);

		world.fetch.mockImplementation(recordedFetch);
		await fileCompletedTransfers({ now: at(NZB2RD_TICK, 5 * 60 * 1000) });
		expect(world.filedHashes()).toContain(hashOf('nzb2rd-B1'));
	});

	it('prunes records once their job is a day past the window', async () => {
		await fileCompletedTransfers({ now: at(NZB2RD_TICK) });

		expect(world.repo.pruneTransferFilings).toHaveBeenCalledWith(
			new Date(at(NZB2RD_TICK) - LOOKBACK_MS - 24 * HOUR)
		);
	});
});

describe('completedJobsIn', () => {
	it('keeps only completed jobs with a hash and an IMDb id', () => {
		const ids = completedJobsIn(recorded.nzb2rd.listing, 'nzb2rd', NZB2RD).map((c) => c.job.id);

		expect(ids.sort()).toEqual(
			['nzb2rd-A1', 'nzb2rd-A2', 'nzb2rd-B1', 'nzb2rd-E', 'nzb2rd-F', 'nzb2rd-G'].sort()
		);
	});

	it('reads the services’ zone-less UTC timestamps as UTC', () => {
		const [b1] = completedJobsIn(
			recorded.nzb2rd.listing.filter((j) => j.id === 'nzb2rd-B1'),
			'nzb2rd',
			NZB2RD
		);

		expect(new Date(b1.completedAt).toISOString()).toBe('2026-10-03T21:29:58.000Z');
	});

	// A TB → RD job can be sent to Premiumize instead; its torrent never reached
	// Real-Debrid, so it has no place in RD's availability.
	it('leaves out a TB job sent somewhere other than Real-Debrid', () => {
		const toPremiumize = { ...recordedJob('debrid-D1'), destination: 'premiumize' };

		expect(completedJobsIn([toPremiumize], 'debrid', DEBRID)).toEqual([]);
		expect(completedJobsIn([recordedJob('debrid-D1')], 'debrid', DEBRID)).toHaveLength(1);
	});
});
