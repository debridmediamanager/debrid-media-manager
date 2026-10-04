/**
 * One-off: put back the filed transfers that a concurrent save dropped from
 * their library page.
 *
 * Filing a completed transfer writes its entry into the title's `ScrapedTrue`
 * page, then its `Available` row. The page save used to read the page's array
 * and write it back without a lock, so two filings to one page each wrote an
 * array without the other's release. The Transfers page files every completed
 * row at once: Viva Pinata's first season filed 25 episodes in five seconds on
 * 2026-09-07 and its page kept 4. Measured 2026-10-04 against nzb2rd's and
 * debrid02's own job lists: 1,167 of 4,835 filed nzb2rd releases and 31 of 838
 * debrid02 ones were in `Available` and on no page of their title, 21 of them
 * because the verdict job trashed them, which this leaves alone.
 *
 * Nothing else will ever put the rest back. The completion sweep, the
 * card-205 backfill and the Transfers page all stop at `Available`, so to them
 * these releases are filed. This finds them and saves each one's entry into
 * the page filing would choose for it now.
 *
 * **Run it only once the locked page save is deployed** (`savePage` in
 * `src/services/database/scraped.ts`). Before that, a filing running at the
 * same moment can drop what this puts back, the same way it dropped the
 * originals.
 *
 * - Jobs come from each transfer service's own `GET /jobs`, read as the
 *   backfill reads them, and only completed ones with a hash and an IMDb id.
 * - A release counts as on its page if its hash is on any page of its title
 *   (`movie:tt…` or any `tv:tt…:N`), not only the one it would be filed under
 *   now, so nothing filed under an older answer is filed twice.
 * - Left alone: anything the verdict job trashed off a page of that title
 *   (`ScrapedTrash`, or a `trash` verdict), a hash on the takedown blocklist,
 *   and a release with no page to file under.
 * - The entry is rebuilt from the `Available` row filed with it, which filing
 *   gave the same title and the same size in bytes (`scrapeEntryFromAvailable`).
 * - Each page is saved once with all of its releases, through the repository,
 *   so the blocklist and the fan-out guard apply as on any save. Its
 *   `updatedAt` is left alone: the Torznab feed dates a page by it and an
 *   *arr's RSS sync reads the most recently updated pages, so putting back
 *   releases filed weeks ago should not present every page as new.
 *
 * Without `--apply` it is a dry run that writes nothing, with every database
 * write refused in-process as in the backfill, and ends by counting the writes
 * it refused, which has to be zero.
 *
 *   npx tsx scripts/repair-lost-filings.ts                 # dry run
 *   npx tsx scripts/repair-lost-filings.ts --apply
 *       [--source nzb2rd|debrid] [--limit N] [--verbose]
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import type { ScrapeSearchResult } from '../src/services/mediasearch';
import type { CompletedJob } from '../src/services/transferFilingSweep';
// Next loads `.env.local` over `.env` on its own; a plain tsx run does not, and
// `.env` carries placeholder database credentials.
config({ path: '.env.local', override: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const apply = flag('--apply');
const verbose = flag('--verbose');
const sourceArg = option('--source');
const limit = option('--limit') ? parseInt(option('--limit')!, 10) : Infinity;
const LIST_TIMEOUT_MS = 5 * 60 * 1000;

if (sourceArg && sourceArg !== 'nzb2rd' && sourceArg !== 'debrid') {
	throw new Error('--source must be nzb2rd or debrid');
}

/** Prisma operations that only read. Anything else is refused in a dry run. */
const READ_OPERATIONS = new Set([
	'findUnique',
	'findUniqueOrThrow',
	'findFirst',
	'findFirstOrThrow',
	'findMany',
	'count',
	'aggregate',
	'groupBy',
]);

/**
 * A client that refuses to write, for the dry run. Refused in-process rather
 * than left to a read-only session, which Prisma loses when it replaces a
 * pooled connection (see `scripts/backfill-transfer-filings.ts`). Installed as
 * the global client before the repository is imported.
 */
function readOnlyClient(refused: string[]): PrismaClient {
	const client = new PrismaClient().$extends({
		query: {
			$allOperations({ model, operation, args, query }) {
				const raw =
					operation === '$queryRaw'
						? (args as { strings?: string[] }).strings?.join('?')
						: operation === '$queryRawUnsafe'
							? (args as unknown[])[0]
							: undefined;
				const reads = model
					? READ_OPERATIONS.has(operation)
					: typeof raw === 'string' &&
						/^\s*select\b/i.test(raw) &&
						!/\bfor\s+update\b/i.test(raw);
				if (!reads) {
					refused.push(`${model ?? 'raw'}.${operation}`);
					throw new Error(`dry run refused a write: ${model ?? 'raw'}.${operation}`);
				}
				return query(args);
			},
		},
	}) as unknown as PrismaClient;
	(globalThis as unknown as { prisma: PrismaClient }).prisma = client;
	return client;
}

const chunks = <T>(items: T[], size: number): T[][] =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
		items.slice(i * size, (i + 1) * size)
	);

type Outcome = 'on-page' | 'trashed' | 'blocked' | 'no-page' | 'refile';

let client: PrismaClient | undefined;
const refusedWrites: string[] = [];

async function main() {
	client = apply ? new PrismaClient() : readOnlyClient(refusedWrites);
	const sql = client;

	// Imported only now, so the repository picks up the read-only client above.
	const { repository: db } = await import('../src/services/repository');
	const sweep = await import('../src/services/transferFilingSweep');
	const { filingPageOf } = await import('../src/services/transferRegistration');
	const { scrapeEntryFromAvailable } = await import('../src/services/debridUploaderRegistration');
	const { isHashBlocked } = await import('../src/services/takedown/blocklist');

	const completed: CompletedJob[] = [];
	for (const { source, server } of sweep
		.transferServices()
		.filter(({ source }) => !sourceArg || source === sourceArg)) {
		const response = await fetch(`${server}/jobs`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`${source} at ${server} answered ${response.status}`);
		completed.push(...sweep.completedJobsIn(await response.json(), source, server));
	}
	// One job per release: a release resubmitted and completed twice is one entry.
	const jobs = [...new Map(completed.map((c) => [`${c.source}:${c.hash}`, c])).values()];

	// The releases filing reached `Available` with.
	const available = new Map<string, { imdbId: string; filename: string; bytes: bigint }>();
	for (const hashes of chunks([...new Set(jobs.map((j) => j.hash))], 500)) {
		const rows = await sql.available.findMany({
			where: { hash: { in: hashes } },
			select: { hash: true, imdbId: true, filename: true, bytes: true },
		});
		for (const row of rows) available.set(row.hash.toLowerCase(), row);
	}
	const filed = jobs.filter((j) => available.has(j.hash));

	// Which of those are on some page of their title, under the job's IMDb id or
	// the `Available` row's, in case the two ever differ.
	const titlesOf = (j: CompletedJob) => [
		...new Set([j.job.imdb_id as string, available.get(j.hash)!.imdbId]),
	];
	const hashesByTitle = new Map<string, Set<string>>();
	for (const j of filed) {
		for (const imdbId of titlesOf(j)) {
			hashesByTitle.set(imdbId, (hashesByTitle.get(imdbId) ?? new Set()).add(j.hash));
		}
	}
	const onPage = new Set<string>();
	for (const titles of chunks([...hashesByTitle.keys()], 100)) {
		const hashes = [...new Set(titles.flatMap((t) => [...hashesByTitle.get(t)!]))];
		const pages = titles.map(
			(t) => Prisma.sql`s.\`key\` = ${`movie:${t}`} OR s.\`key\` LIKE ${`tv:${t}:%`}`
		);
		const rows = await sql.$queryRaw<{ key: string; hash: string }[]>`
			SELECT s.\`key\` AS \`key\`, LOWER(jt.hash) AS hash
			FROM ScrapedTrue s,
				JSON_TABLE(s.value, '$[*]' COLUMNS (hash VARCHAR(64) PATH '$.hash')) jt
			WHERE (${Prisma.join(pages, ' OR ')}) AND LOWER(jt.hash) IN (${Prisma.join(hashes)})`;
		for (const row of rows) onPage.add(`${row.key.split(':')[1]}:${row.hash}`);
	}

	// What the verdict job took off a page of that title stays off.
	const trashed = new Set<string>();
	for (const hashes of chunks([...new Set(filed.map((j) => j.hash))], 500)) {
		const [trash, verdicts] = await Promise.all([
			sql.scrapedTrash.findMany({
				where: { source: 'ScrapedTrue', hash: { in: hashes } },
				select: { hash: true, imdbId: true },
			}),
			sql.scrapedVerdict.findMany({
				where: { verdict: 'trash', hash: { in: hashes } },
				select: { hash: true, imdbId: true },
			}),
		]);
		for (const row of [...trash, ...verdicts]) {
			trashed.add(`${row.imdbId}:${row.hash.toLowerCase()}`);
		}
	}

	const tally = new Map<string, number>();
	const count = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
	const toRefile = new Map<string, ScrapeSearchResult[]>();
	let examined = 0;

	for (const j of filed) {
		if (examined >= limit) break;
		const titles = titlesOf(j);
		let outcome: Outcome;
		let page: string | null = null;
		if (titles.some((t) => onPage.has(`${t}:${j.hash}`))) outcome = 'on-page';
		else if (titles.some((t) => trashed.has(`${t}:${j.hash}`))) outcome = 'trashed';
		else if (await isHashBlocked(j.hash)) outcome = 'blocked';
		else if (!(page = await filingPageOf(j.source, j.job))) outcome = 'no-page';
		else outcome = 'refile';

		if (outcome !== 'on-page') examined++;
		count(`${j.source} ${outcome}`);
		if (outcome === 'refile' && page) {
			const entry = scrapeEntryFromAvailable({ hash: j.hash, ...available.get(j.hash)! });
			toRefile.set(page, [...(toRefile.get(page) ?? []), entry]);
		}
		if (verbose && outcome !== 'on-page') {
			console.log(`${outcome}\t${j.source}\t${page ?? j.job.imdb_id}\t${j.job.name}`);
		}
	}

	console.log(
		`${jobs.length} completed release(s) with a hash and an IMDb id, ` +
			`${filed.length} in Available` +
			(apply ? '' : ' (dry run, read-only)')
	);
	for (const [key, n] of [...tally.entries()].sort()) console.log(`${key}: ${n}`);
	const entries = [...toRefile.values()].reduce((n, e) => n + e.length, 0);
	console.log(
		`${apply ? 'refiling' : 'would refile'} ${entries} release(s) on ${toRefile.size} page(s)`
	);

	if (!apply) {
		console.log(`refused ${refusedWrites.length} write(s)`, refusedWrites.slice(0, 10));
		if (refusedWrites.length > 0) process.exitCode = 1;
		return;
	}

	let back = 0;
	let missing = 0;
	for (const [page, results] of toRefile) {
		await db.saveScrapedTrueResults(page, results, false);
		const stored = new Set(
			((await db.getAllScrapedTrueResults(page)) ?? []).map((r) => r.hash.toLowerCase())
		);
		for (const r of results) {
			if (stored.has(r.hash)) back++;
			else {
				missing++;
				console.warn(`not on ${page} after saving: ${r.hash} ${r.title}`);
			}
		}
	}
	console.log(`${back} release(s) back on their page, ${missing} not`);
	if (missing > 0) process.exitCode = 1;
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(async () => {
		const { repository } = await import('../src/services/repository');
		await repository.disconnect();
		await client?.$disconnect();
	});
