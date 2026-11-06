// @vitest-environment node
/**
 * Title search against a real MySQL, for titles made of short words.
 *
 * dmmdb's fulltext index keeps no word shorter than three characters and no
 * stopword, so "20/20", "Up", "It", "Us", "24", "9-1-1" and "M*A*S*H" were in
 * no index. Searching "20/20" (asked about on Reddit, 2026-10-24) matched the
 * prefix "+20*" instead and listed the films 2020, 2012 and 2046; "it" and
 * "9-1-1" listed nothing. The rows are every title search returned for these
 * queries on dmmdb that day (`imdb-short-titles-2026-10-24.json`), and the
 * tables are dmmdb's own DDL on the server version it runs.
 *
 * It also runs the searches that fell through to the LIKE '%…%' scan on dmmdb
 * (`imdb-search-misses-2026-11-06.json`) and reads the plan of every statement
 * they send.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import type { ImdbSearchService } from '@/services/database/imdbSearch';
import misses from '@/test/fixtures/imdb-search-misses-2026-11-06.json';
import recorded from '@/test/fixtures/imdb-short-titles-2026-10-24.json';
import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

const DDL = readFileSync(
	path.resolve(__dirname, '../../fixtures/mysql/imdb-search-tables.sql'),
	'utf8'
)
	.split(/^;$/m)
	.map((statement) =>
		statement
			.split('\n')
			.filter((line) => !line.startsWith('--'))
			.join('\n')
			.trim()
	)
	.filter(Boolean);

describe.skipIf(!dockerAvailable)(
	'Searching short-word titles and misses on MySQL 8.0.36 (Integration)',
	() => {
		let container: StartedTestContainer;
		let monitor: PrismaClient;
		let handler: typeof import('@/pages/api/search/title').default;

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
			for (const b of recorded.basics) {
				await monitor.$executeRaw`INSERT INTO imdb_title_basics
				(tconst, title_type, primary_title, original_title, is_adult, start_year)
				VALUES (${b.tconst}, ${b.title_type}, ${b.primary_title}, ${b.original_title}, ${b.is_adult}, ${b.start_year})`;
			}
			for (const r of recorded.ratings) {
				await monitor.$executeRaw`INSERT INTO imdb_title_ratings (tconst, average_rating, num_votes)
				VALUES (${r.tconst}, ${r.average_rating}, ${r.num_votes})`;
			}
			// The repository builds the app's one Prisma client from DATABASE_URL when
			// it is first imported.
			process.env.DATABASE_URL = url;
			handler = (await import('@/pages/api/search/title')).default;
		}, 240_000);

		afterAll(async () => {
			const { repository } = await import('@/services/repository');
			await repository.disconnect();
			await monitor?.$disconnect();
			await container?.stop();
		});

		async function search(keyword: string): Promise<Array<{ imdbid: string; title: string }>> {
			let body: any;
			const res = {
				status: () => res,
				json: (b: any) => (body = b),
			} as unknown as NextApiResponse;
			await handler({ query: { keyword } } as unknown as NextApiRequest, res);
			return body.results;
		}

		it.each([
			['20/20', 'tt0124932'], // ABC's newsmagazine, 1978
			['Up', 'tt1049413'], // Pixar, 2009
			['It', 'tt1396484'], // 2017
			['Us', 'tt6857112'], // 2019
			['24', 'tt0285331'], // the 2001 series
			['9-1-1', 'tt7235466'], // 2018
			['M*A*S*H', 'tt0068098'], // the 1972 series
		])('finds %s', async (keyword, imdbid) => {
			const results = await search(keyword);

			expect(results.slice(0, 3).map((r) => r.imdbid)).toContain(imdbid);
		});

		it('lists every 20/20 before titles that only start with 20', async () => {
			const results = await search('20/20');

			const titles = results.map((r) => r.title);
			const lastExact = titles.lastIndexOf('20/20');
			expect(titles[0]).toBe('20/20');
			expect(titles.slice(0, lastExact).every((t) => /^20\W20$/.test(t))).toBe(true);
		});

		// No index serves LIKE '%…%', so dmmdb read those titles one by one: 1.4 s for a show,
		// the 5 s cap for anything else, and no title found either way (2026-11-06).
		type SearchArgs = Parameters<ImdbSearchService['searchTitles']>;
		it.each(misses.misses.map((m) => [m.request, ...(m.search as SearchArgs)] as const))(
			'finds nothing for %s by index alone',
			async (_request, keyword, options) => {
				const { repository } = await import('@/services/repository');
				const prisma = (repository as any).imdbSearchService.prisma as PrismaClient;
				const sent = vi.spyOn(prisma, '$queryRaw');

				const results = await repository.searchImdbTitles(keyword, options);
				const statements = sent.mock.calls.map(([query]) => query as Prisma.Sql);
				sent.mockRestore();

				expect(results).toEqual([]);
				expect(statements.length).toBeGreaterThan(0);
				for (const statement of statements) {
					const plan = await monitor.$queryRaw<Array<Record<string, unknown>>>(
						Prisma.sql`EXPLAIN ${statement}`
					);
					for (const step of plan) {
						// Prisma names EXPLAIN's columns f0, f1, …, in MySQL's order: id, select_type, table, partitions, type, possible_keys, key
						const [, , table, , , , key] = Object.values(step);
						// The search words' fulltext index, then joins on the primary key; the LIKE scan read b by none of them
						expect({ table, key }).toEqual({
							table,
							key: expect.stringMatching(/^(ft_primary_title|ft_title|PRIMARY)$/),
						});
					}
				}
			}
		);
	}
);
