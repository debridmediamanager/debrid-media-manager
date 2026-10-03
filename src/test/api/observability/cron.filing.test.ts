import handler from '@/pages/api/observability/cron';
import { repository as db } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	DEBRID,
	DEBRID_TICK,
	NZB2RD,
	NZB2RD_TICK,
	recordedJob,
	transferWorld,
} from '@/test/utils/transferFilingWorld';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/lib/observability/streamServersHealth', () => ({
	runHealthCheckNow: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/observability/torrentioHealth', () => ({
	runTorrentioHealthCheckNow: vi.fn().mockResolvedValue(undefined),
}));

/**
 * The cron is the only part of DMM that runs without a browser, so it is where a
 * finished transfer has to be filed if nobody ever looks at it.
 *
 * Driven by what production held on 2026-10-03 (see the fixture README): jobs
 * that had completed on nzb2rd and debrid02 and were in no DMM search result,
 * because the paths that filed a Usenet job were a Transfers page row, a title
 * page's Usenet section and a per-job poll, and the cron filed a TB → RD job
 * only through a pending `tbrd:` mapping. Measured that day, 2862 of 7656
 * completed nzb2rd jobs and 95 of 932 debrid02 jobs were in that state.
 */

let world: ReturnType<typeof transferWorld>;

const tick = async (at: Date) => {
	vi.setSystemTime(at);
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'POST' }), res);
	expect(res.status).toHaveBeenCalledWith(200);
	return res._getData() as Record<string, any>;
};

const hashOf = (id: string) => recordedJob(id).info_hash.toLowerCase();

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	delete process.env.CRON_SECRET;
	process.env.NZB2RD_URL = NZB2RD;
	process.env.DEBRID_UPLOADER_URLS = DEBRID;
	world = transferWorld();
	Object.assign(db, world.repo);
	vi.stubGlobal('fetch', world.fetch);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('cron: filing completed transfers nobody looked at', () => {
	it('files completed Usenet jobs into search on a cron tick', async () => {
		await tick(NZB2RD_TICK);

		// Two DMM submissions, filed under the page each was started from, and
		// one job with no DMM record at all, filed under the season its release
		// names because IMDb calls the title a series.
		expect(world.scraped.get('movie:tt0117108')).toEqual([
			expect.objectContaining({ hash: hashOf('nzb2rd-A1') }),
		]);
		expect(world.scraped.get('tv:tt37063558:2')).toEqual([
			expect.objectContaining({ hash: hashOf('nzb2rd-A2') }),
		]);
		expect(world.scraped.get('tv:tt11363282:1')).toEqual([
			expect.objectContaining({ hash: hashOf('nzb2rd-B1') }),
		]);
		expect(world.filedHashes().sort()).toEqual(
			[hashOf('nzb2rd-A1'), hashOf('nzb2rd-A2'), hashOf('nzb2rd-B1')].sort()
		);
	});

	it("moves a DMM submission's release marker to completed, so its Usenet row reads In RD", async () => {
		await tick(NZB2RD_TICK);

		const marker = [...world.markers.values()].find((m) => m.jobId === 'nzb2rd-A1');
		expect(marker).toMatchObject({ status: 'completed', infoHash: hashOf('nzb2rd-A1') });
	});

	it('leaves alone what it must not file', async () => {
		await tick(NZB2RD_TICK);

		const filed = world.filedHashes();
		// Already in search.
		expect(filed).not.toContain(hashOf('nzb2rd-F'));
		// A DVD image: VOB files and no video DMM can list.
		expect(filed).not.toContain(hashOf('nzb2rd-E'));
		expect(world.filings.get('nzb2rd:nzb2rd-E')).toMatchObject({
			outcome: 'refused',
			reason: 'no-video',
		});
		// Finished before the sweep's window; the backfill's to file.
		expect(filed).not.toContain(hashOf('nzb2rd-G'));
		// Completed with no IMDb id, so there is no title to file it under.
		expect(filed).not.toContain(hashOf('nzb2rd-I'));
		// Neither those nor a failed job is even looked up.
		for (const id of ['nzb2rd-F', 'nzb2rd-G', 'nzb2rd-H', 'nzb2rd-I']) {
			expect(world.requests).not.toContain(`${NZB2RD}/jobs/${id}`);
		}
	});

	it('files completed TB → RD jobs that no pending mapping pointed at', async () => {
		await tick(DEBRID_TICK);

		// Both were DMM submissions whose stored context had no page, and neither
		// had a `tbrd:` mapping for the existing reconcile sweep to find.
		expect(world.scraped.get('tv:tt13210838:2')).toEqual([
			expect.objectContaining({ hash: hashOf('debrid-D1') }),
		]);
		expect(world.scraped.get('tv:tt5555260:1')).toEqual([
			expect.objectContaining({ hash: hashOf('debrid-D2') }),
		]);
	});

	it('reports what the sweep did in the cron response', async () => {
		const body = await tick(NZB2RD_TICK);

		expect(body.transferFilings).toMatchObject({ filed: 3, refused: 1, unreachable: 0 });
	});
});
