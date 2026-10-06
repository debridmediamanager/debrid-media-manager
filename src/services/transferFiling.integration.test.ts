// @vitest-environment node
/**
 * Filing a finished transfer into search against a real MySQL, with the names
 * that broke it.
 *
 * Filing writes a release twice: an entry on its library page (`ScrapedTrue`)
 * and a row in `Available`, which is what makes search call it cached. The title
 * went into both cut at 255 characters, and the raw name into
 * `Available.originalFilename` uncut, but both columns are varchar(191). So a
 * name past 191 characters filed its page entry, then failed the `Available`
 * insert: "The provided value for the column is too long for the column's type.
 * Column: filename". The page kept the entry, every retry rewrote the page and
 * failed again, and the backfill took the leftover entry for a false-positive
 * eviction and skipped it.
 *
 * On 2026-10-06 none of the 11 completed jobs across both services with a name
 * past 191 characters was in `Available`, and 7 of them sat on their page.
 * debrid02's 249-character "[GSH]" release failed every cron tick from 01:35 UTC,
 * 223 of them by 20:10. The
 * jobs here are three of those seven as their services served them
 * (`fixtures/transfers/half-filed-2026-10-06.json`), and the tables are dmmdb's
 * own DDL on the server version it runs.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import recorded from '@/test/fixtures/transfers/half-filed-2026-10-06.json';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

const ddl = (file: string) =>
	readFileSync(path.resolve(__dirname, '../test/fixtures/mysql', file), 'utf8')
		.split(/^;$/m)
		.map((statement) =>
			statement
				.split('\n')
				.filter((line) => !line.startsWith('--'))
				.join('\n')
				.trim()
		)
		.filter(Boolean);
const DDL = [...ddl('scraped-tables.sql'), ...ddl('filing-tables.sql')];

const NZB2RD = 'http://nzb2rd.test:3200';
const DEBRID = 'http://debrid02.test:3100';

type Job = Record<string, any>;
const nzb2rdJobs = recorded.nzb2rd.jobs as Record<string, Job>;
const debridFiles = recorded.debrid.files as Record<string, Job[]>;
const metaOf = (jobId: string): { releaseId?: string } =>
	recorded.dmm.transferMeta.find((m) => m.jobId === jobId)!;
const pageEntryOf = (hash: string) => recorded.dmm.pages.find((p) => p.entry.hash === hash)!;

const JOBS: { label: string; source: 'nzb2rd' | 'debrid'; job: Job }[] = [
	...Object.values(nzb2rdJobs).map((job) => ({
		label: job.id,
		source: 'nzb2rd' as const,
		job,
	})),
	...recorded.debrid.listing.map((job) => ({ label: job.id, source: 'debrid' as const, job })),
];
const GSH = recorded.debrid.listing.find((j) => j.id === 'debrid-gsh')!;

const chars = (value: string) => Array.from(value).length;

describe.skipIf(!dockerAvailable)(
	'Filing long-named transfers on MySQL 8.0.36 (Integration)',
	() => {
		let container: StartedTestContainer;
		let monitor: PrismaClient;
		let registration: typeof import('./transferRegistration');
		let sweep: typeof import('./transferFilingSweep');

		beforeAll(async () => {
			container = await new GenericContainer('mysql:8.0.36')
				.withEnvironment({ MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'dmm_test' })
				.withExposedPorts(3306)
				.withTmpFs({ '/var/lib/mysql': 'rw' })
				// The init run logs "ready for connections" on port 0 first.
				.withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306 /))
				.withStartupTimeout(180_000)
				.start();
			const url = `mysql://root:test@${container.getHost()}:${container.getMappedPort(3306)}/dmm_test`;
			monitor = new PrismaClient({ datasourceUrl: url });
			for (const statement of DDL) await monitor.$executeRawUnsafe(statement);
			// The repository builds the app's one Prisma client from DATABASE_URL when
			// it is first imported, and the sweep reads the service URLs per call.
			process.env.DATABASE_URL = `${url}?connection_limit=20`;
			process.env.NZB2RD_URL = NZB2RD;
			process.env.DEBRID_UPLOADER_URLS = DEBRID;
			registration = await import('./transferRegistration');
			sweep = await import('./transferFilingSweep');
		}, 240_000);

		afterAll(async () => {
			const { repository } = await import('./repository');
			await repository.disconnect();
			await monitor?.$disconnect();
			await container?.stop();
		});

		beforeEach(async () => {
			for (const table of [
				'ScrapedTrue',
				'HashPageCount',
				'Available',
				'AvailableFile',
				'Cache',
			]) {
				await monitor.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
			}
			await mysql('DROP TRIGGER IF EXISTS refuse_available');
			await monitor.$executeRawUnsafe('DELETE FROM imdb_title_basics');
			for (const [tconst, titleType] of Object.entries(recorded.dmm.imdbTitleTypes)) {
				await monitor.$executeRaw`INSERT INTO imdb_title_basics (tconst, title_type)
				VALUES (${tconst}, ${titleType})`;
			}
			// The page each transfer was started from, as `xfer:` held it: only the
			// Usenet one recorded a returnPath, so the other two are filed by title type.
			for (const meta of recorded.dmm.transferMeta) {
				await monitor.cache.create({
					data: {
						key: `xfer:${meta.source}:${meta.jobId}`,
						value: { ...meta, updatedAt: Date.parse(recorded.recordedAt) },
					},
				});
			}
			vi.stubGlobal(
				'fetch',
				vi.fn(async (input: string | URL) => {
					const url = String(input);
					const answer = (body: unknown) =>
						new Response(JSON.stringify(body), { status: 200 });
					// nzb2rd's listing leaves the files out; `GET /jobs/:id` adds them.
					if (url === `${NZB2RD}/jobs`) {
						return answer(
							Object.values(nzb2rdJobs).map((job) => {
								const listed = { ...job };
								delete listed.files;
								return listed;
							})
						);
					}
					if (url === `${DEBRID}/jobs`) return answer(recorded.debrid.listing);
					const nzbJob = url.match(/^http:\/\/nzb2rd\.test:3200\/jobs\/([^/]+)$/);
					if (nzbJob && nzb2rdJobs[nzbJob[1]]) return answer(nzb2rdJobs[nzbJob[1]]);
					const files = url.match(/^http:\/\/debrid02\.test:3100\/jobs\/([^/]+)\/files$/);
					if (files && debridFiles[files[1]]) return answer(debridFiles[files[1]]);
					throw new Error(`no recorded answer for ${url}`);
				})
			);
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		const file = (source: 'nzb2rd' | 'debrid', job: Job) =>
			source === 'nzb2rd'
				? registration.fileCompletedNzb2rdJob(
						job,
						undefined,
						undefined,
						metaOf(job.id).releaseId
					)
				: registration.fileCompletedDebridJob(job, undefined, undefined, DEBRID);

		/** A statement Prisma cannot send: it prepares every one, and MySQL will not prepare a trigger. */
		const mysql = async (sql: string) => {
			const { exitCode, output } = await container.exec([
				'mysql',
				'-uroot',
				'-ptest',
				'dmm_test',
				'-e',
				sql,
			]);
			if (exitCode !== 0) throw new Error(`mysql: ${output}`);
		};

		/** Whatever makes the `Available` insert fail, the page must not keep the entry. */
		const refuseAvailableInserts = () =>
			mysql(
				`CREATE TRIGGER refuse_available BEFORE INSERT ON Available FOR EACH ROW
			 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Available insert refused by the test'`
			);

		const page = async (key: string) => {
			const row = await monitor.scrapedTrue.findUnique({ where: { key } });
			return (
				row && {
					entries: row.value as { hash: string; title: string }[],
					updatedAt: row.updatedAt,
				}
			);
		};

		it.each(JOBS)(
			'files $label with one title on its page and in Available',
			async ({ source, job }) => {
				expect(chars(job.name)).toBeGreaterThan(191);

				expect(await file(source, job)).toEqual({ outcome: 'filed' });

				const recordedEntry = pageEntryOf(job.info_hash);
				const filed = await page(recordedEntry.key);
				const entry = filed?.entries.find((e) => e.hash === job.info_hash);
				const row = await monitor.available.findUnique({
					where: { hash: job.info_hash },
					include: { files: true },
				});
				expect(row).not.toBeNull();
				expect(chars(row!.filename)).toBeLessThanOrEqual(191);
				expect(chars(row!.originalFilename)).toBeLessThanOrEqual(191);
				expect(job.name.startsWith(row!.originalFilename)).toBe(true);
				// The page production holds, cut to the column the row has.
				expect(row!.filename).toBe(
					Array.from(recordedEntry.entry.title).slice(0, 191).join('')
				);
				expect(entry?.title).toBe(row!.filename);
				expect(row!.files).toHaveLength(
					(source === 'nzb2rd' ? job.files : debridFiles[job.id]).filter(
						(f: Job) => f.rd_link && f.size > 0
					).length
				);
			}
		);

		it('leaves no page entry behind when the Available insert fails', async () => {
			await refuseAvailableInserts();
			const key = pageEntryOf(GSH.info_hash).key;

			await expect(file('debrid', GSH)).rejects.toThrow();

			expect(await page(key)).toBeNull();
			expect(await monitor.available.count()).toBe(0);
			expect(await monitor.availableFile.count()).toBe(0);
		});

		it('keeps the rest of the page as it was when the Available insert fails', async () => {
			const key = pageEntryOf(GSH.info_hash).key;
			const before = new Date('2026-10-05T12:00:00Z');
			const neighbour = {
				hash: 'f'.repeat(40),
				title: 'An earlier release on the same page',
				fileSize: 1024,
			};
			await monitor.scrapedTrue.create({
				data: { key, value: [neighbour], updatedAt: before },
			});
			await refuseAvailableInserts();

			await expect(file('debrid', GSH)).rejects.toThrow();

			expect(await page(key)).toEqual({ entries: [neighbour], updatedAt: before });
		});

		// Production's cron, 2026-10-06 from 01:35 UTC: `due: 1, filed: 0, errors: 1`
		// every five minutes, the page rewritten each time.
		it('files the [GSH] release on the first cron tick and does not try it again', async () => {
			const firstTick = Date.parse('2026-10-06T01:35:10Z');

			const first = await sweep.fileCompletedTransfers({ now: firstTick });
			expect(first).toMatchObject({ completed: 1, due: 1, filed: 1, errors: 0 });
			const filed = await page(pageEntryOf(GSH.info_hash).key);

			const second = await sweep.fileCompletedTransfers({ now: firstTick + 5 * 60 * 1000 });
			expect(second).toMatchObject({ completed: 1, due: 0, filed: 0, errors: 0 });
			expect(await page(pageEntryOf(GSH.info_hash).key)).toEqual(filed);
			expect(
				await monitor.available.findUnique({ where: { hash: GSH.info_hash } })
			).not.toBeNull();
		});
	}
);
