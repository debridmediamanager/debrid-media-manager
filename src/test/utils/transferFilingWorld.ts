import fixture from '@/test/fixtures/transfers/completed-unfiled-2026-10-03.json';
import { vi } from 'vitest';

/**
 * DMM and its two transfer services as they stood on 2026-10-03, for tests of
 * filing a completed transfer into search.
 *
 * The uploader answers are the recorded `GET /jobs`, `GET /jobs/:id` and
 * `GET /jobs/:id/files` bodies in `completed-unfiled-2026-10-03.json`, and the
 * repository is an in-memory stand-in seeded from what the database held for
 * those jobs: which hashes `Available` had, the stored page context, the
 * `nzbrd:` markers and the IMDb title types. Writes land in the same maps, so a
 * second tick sees what the first one wrote.
 */

export const NZB2RD = 'http://nzb2rd.test:3200';
export const DEBRID = 'http://debrid02.test:3100';

/** The cron ticks the recordings are read at: just after the newest completion of each service. */
export const NZB2RD_TICK = new Date('2026-10-03T22:00:00Z');
export const DEBRID_TICK = new Date('2026-09-24T12:00:00Z');

export const recorded = fixture;

type Json = Record<string, any>;

export function transferWorld() {
	const available = new Map<string, Json>(fixture.dmm.available.map((hash) => [hash, { hash }]));
	const scraped = new Map<string, Json[]>();
	const markers = new Map<string, Json>(
		fixture.dmm.nzbrdMarkers.map((m) => [m.releaseId, { ...m }])
	);
	const meta = new Map<string, Json>(
		fixture.dmm.transferMeta.map((m) => [`${m.source}:${m.jobId}`, m])
	);
	const filings = new Map<string, Json>();
	const tbrd = new Map<string, Json>();
	const requests: string[] = [];

	const answer = (status: number, body: unknown) => ({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	});

	const fetch = vi.fn(async (input: string | URL) => {
		const url = String(input);
		requests.push(url);
		if (url === `${NZB2RD}/jobs`) return answer(200, fixture.nzb2rd.listing);
		if (url === `${DEBRID}/jobs`) return answer(200, fixture.debrid.listing);
		const nzbJob = url.match(/^http:\/\/nzb2rd\.test:3200\/jobs\/([^/]+)$/);
		if (nzbJob) {
			const job = (fixture.nzb2rd.jobs as Record<string, Json>)[
				decodeURIComponent(nzbJob[1])
			];
			return job ? answer(200, job) : answer(404, { error: 'not found' });
		}
		const debridFiles = url.match(/^http:\/\/debrid02\.test:3100\/jobs\/([^/]+)\/files$/);
		if (debridFiles) {
			const files = (fixture.debrid.files as Record<string, Json[]>)[debridFiles[1]];
			return files ? answer(200, files) : answer(404, { error: 'not found' });
		}
		const debridJob = url.match(/^http:\/\/debrid02\.test:3100\/jobs\/([^/]+)$/);
		if (debridJob) {
			const job = fixture.debrid.listing.find((j) => j.id === debridJob[1]);
			return job ? answer(200, job) : answer(404, { error: 'not found' });
		}
		throw new Error(`no recorded answer for ${url}`);
	});

	const has = (hashes: string[]) => hashes.filter((h) => available.has(h.toLowerCase()));

	const repo = {
		// The cron's other duties, which these tests are not about.
		runDailyRollup: vi.fn(async () => ({
			streamDailyRolled: false,
			rdDailyRolled: false,
			torrentioDailyRolled: false,
		})),
		rollupTorBoxOperationalDaily: vi.fn(async () => false),
		rollupTorBoxCdnDaily: vi.fn(async () => false),

		// TB → RD mappings, which none of the recorded jobs had.
		listPendingDebridTransfers: vi.fn(async () =>
			[...tbrd.values()].filter((r) => r.status === 'pending')
		),
		listCompletedDebridTransfers: vi.fn(async () =>
			[...tbrd.values()].filter((r) => r.status === 'completed')
		),
		touchDebridTransfer: vi.fn(async () => undefined),
		removeDebridTransfer: vi.fn(async (hash: string) => void tbrd.delete(hash)),
		getDebridJobServer: vi.fn(async () => DEBRID),
		recordDebridTransferCompleted: vi.fn(
			async (originalHash: string, jobId: string, imdbId: string, rewrittenHash: string) =>
				void tbrd.set(originalHash, {
					originalHash,
					jobId,
					imdbId,
					rewrittenHash,
					status: 'completed',
				})
		),

		getCachedRdNames: vi.fn(
			async (hashes: string[]) =>
				new Map(has(hashes).map((h) => [h, { filename: h, originalFilename: h }]))
		),
		checkAvailabilityByHashes: vi.fn(async (hashes: string[]) =>
			has(hashes).map((hash) => ({ hash, files: [] }))
		),
		getTransferMeta: vi.fn(async (jobs: { source: string; jobId: string }[]) => {
			const found = new Map<string, Json>();
			for (const j of jobs) {
				const m = meta.get(`${j.source}:${j.jobId}`);
				if (m) found.set(`${j.source}:${j.jobId}`, m);
			}
			return found;
		}),
		getImdbTitleType: vi.fn(
			async (imdbId: string) =>
				(fixture.dmm.imdbTitleTypes as Record<string, string>)[imdbId] ?? null
		),

		getTransferFilings: vi.fn(async (jobs: { source: string; jobId: string }[]) => {
			const found = new Map<string, Json>();
			for (const j of jobs) {
				const r = filings.get(`${j.source}:${j.jobId}`);
				if (r) found.set(`${j.source}:${j.jobId}`, r);
			}
			return found;
		}),
		recordTransferFiling: vi.fn(async (record: Json, at: number = Date.now()) => {
			filings.set(`${record.source}:${record.jobId}`, { ...record, at });
		}),
		pruneTransferFilings: vi.fn(async () => 0),

		saveScrapedTrueResults: vi.fn(async (key: string, entries: Json[]) => {
			scraped.set(key, [...(scraped.get(key) ?? []), ...entries]);
		}),
		upsertAvailability: vi.fn(async (row: Json) => void available.set(row.hash, row)),
		recordNzb2rdTransferCompleted: vi.fn(
			async (releaseId: string, jobId: string, imdbId: string, infoHash: string) =>
				void markers.set(releaseId, {
					releaseId,
					jobId,
					imdbId,
					status: 'completed',
					infoHash,
				})
		),
		takeNzb2rdWaiters: vi.fn(async () => []),
	};

	return {
		repo,
		fetch,
		available,
		scraped,
		markers,
		filings,
		requests,
		/** What `/api/availability/remove` does on a user's false-positive report. */
		evict: (hash: string) => available.delete(hash),
		filedHashes: () =>
			repo.upsertAvailability.mock.calls.map(([row]) => (row as Json).hash as string),
	};
}

/** A recorded job by its fixture id, from whichever service listed it. */
export function recordedJob(id: string): Json {
	const job =
		fixture.nzb2rd.listing.find((j) => j.id === id) ??
		fixture.debrid.listing.find((j) => j.id === id);
	if (!job) throw new Error(`no recorded job ${id}`);
	return job;
}
