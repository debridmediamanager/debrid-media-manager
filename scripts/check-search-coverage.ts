/**
 * Check that search can find what users stream. Runs daily after the IMDb
 * import from `scripts/imdb-import/run.sh`; `src/services/searchCoverage.ts`
 * says what is checked and why.
 *
 *   bun scripts/check-search-coverage.ts [--days N]
 *
 * Reads only. Exits non-zero with a line starting `FAILED:` when a title with a
 * page that enough users streamed in the last N days (default 30) cannot be
 * found, or when search finds too small a share of streams.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { searchableTitleSql } from '../src/services/database/searchableTitles';
import { summarizeCoverage, type StreamedTitle } from '../src/services/searchCoverage';

/** Every table a cast profile records streams in; each keys its titles by IMDb id. */
const CAST_TABLES = [
	'Cast',
	'TorBoxCast',
	'AllDebridCast',
	'PremiumizeCast',
	'OffcloudCast',
	'DebridLinkCast',
];

class RunFailure extends Error {}

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

async function main(prisma: PrismaClient) {
	const at = process.argv.indexOf('--days');
	const days = at >= 0 ? Number(process.argv[at + 1]) : 30;
	if (!Number.isSafeInteger(days) || days <= 0) throw new RunFailure('--days needs a number');

	// A show's streams are keyed `tt…:season:episode`; the title is the part before.
	// The cast tables are utf8mb4_unicode_ci and the imdb_* tables
	// utf8mb4_0900_ai_ci, and MySQL refuses to compare the two. `GROUP BY 1`,
	// because each cast table has its own `id` column, which `GROUP BY id` means.
	const streams = Prisma.join(
		CAST_TABLES.map(
			(table) =>
				Prisma.sql`SELECT SUBSTRING_INDEX(imdbId, ':', 1) COLLATE utf8mb4_0900_ai_ci AS id, COUNT(DISTINCT userId) AS users
					FROM ${Prisma.raw(`\`${table}\``)}
					WHERE imdbId LIKE 'tt%' AND updatedAt >= NOW() - INTERVAL ${days} DAY
					GROUP BY 1`
		),
		' UNION ALL '
	);
	const rows = await prisma.$queryRaw<
		Array<{
			id: string;
			users: unknown;
			titleType: string | null;
			isAdult: unknown;
			searchable: unknown;
		}>
	>(Prisma.sql`
		SELECT s.id, SUM(s.users) AS users, b.title_type AS titleType, b.is_adult AS isAdult,
			COALESCE(${searchableTitleSql()}, 0) AS searchable
		FROM (${streams}) s
		LEFT JOIN imdb_title_basics b ON b.tconst = s.id
		LEFT JOIN imdb_title_ratings r ON r.tconst = s.id
		GROUP BY s.id, b.title_type, b.is_adult, b.start_year, r.tconst, r.num_votes
	`);

	const titles: StreamedTitle[] = rows.map((row) => ({
		imdbId: row.id,
		users: Number(row.users),
		titleType: row.titleType,
		isAdult: Boolean(Number(row.isAdult)),
		searchable: Boolean(Number(row.searchable)) && !Number(row.isAdult),
	}));
	const report = summarizeCoverage(titles);

	log(
		`Search coverage over the last ${days} days: ${(report.share * 100).toFixed(2)}% of streams`
	);
	for (const bucket of Object.keys(report.titles) as Array<keyof typeof report.titles>) {
		log(
			`  ${bucket.padEnd(20)} ${report.titles[bucket]} titles, ${report.streams[bucket]} streams`
		);
	}
	for (const [bucket, list] of Object.entries(report.top)) {
		if (list.length === 0) continue;
		log(`  biggest ${bucket}:`);
		for (const t of list) log(`    ${t.imdbId} ${t.titleType ?? '-'} ${t.users} users`);
	}
	if (report.alerts.length > 0) throw new RunFailure(report.alerts.join('; '));
}

const prisma = new PrismaClient();
main(prisma)
	.catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${new Date().toISOString()} FAILED: ${message}`);
		if (!(error instanceof RunFailure) && error instanceof Error && error.stack) {
			console.error(error.stack);
		}
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
