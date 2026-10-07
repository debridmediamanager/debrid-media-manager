// @vitest-environment node
/**
 * Which Cyrillic-led releases the paged library reads drop, run against a real
 * MySQL because the rule is a `REGEXP` inside the query.
 *
 * Card 248: a debrid job filed "Дораэмон Битва против Короля Русалок ... Doraemon
 * Nobita's Great Battle of the Mermaid King ... [2010" on its film's page, and the
 * page never showed it. The paged read dropped every Cyrillic-led title in both
 * tables, which the untrusted one needs and the trusted one does not (see
 * `cyrillicLedDropped`). The pages are recorded from production on 2026-10-07
 * (`fixtures/scraped/cyrillic-led-pages-2026-10-07.json`).
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import recorded from '@/test/fixtures/scraped/cyrillic-led-pages-2026-10-07.json';
import { isCyrillicLed } from '@/utils/cyrillicLed';
import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScrapedService } from './scraped';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

const DDL = readFileSync(
	path.resolve(__dirname, '../../test/fixtures/mysql/scraped-tables.sql'),
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

type Stored = { hash: string; title?: string; filename?: string; fileSize?: number };
type Served = { hash: string; title: string; fileSize: number };

const pageOf = (table: 'ScrapedTrue' | 'Scraped', key: string) =>
	recorded.pages.find((p) => p.table === table && p.key === key)!.value as Stored[];

/** The service under test, on the test database instead of the app's client. */
class ScrapedServiceOn extends ScrapedService {
	constructor(client: PrismaClient) {
		super();
		this.prisma = client;
	}
}

describe.skipIf(!dockerAvailable)('Cyrillic-led releases on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let client: PrismaClient;
	let service: ScrapedService;

	beforeAll(async () => {
		container = await new GenericContainer('mysql:8.0.36')
			.withEnvironment({ MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'dmm_test' })
			.withExposedPorts(3306)
			.withTmpFs({ '/var/lib/mysql': 'rw' })
			// The init run logs "ready for connections" on port 0 first.
			.withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306 /))
			.withStartupTimeout(180_000)
			.start();
		client = new PrismaClient({
			datasourceUrl: `mysql://root:test@${container.getHost()}:${container.getMappedPort(3306)}/dmm_test`,
		});
		for (const statement of DDL) await client.$executeRawUnsafe(statement);
		for (const page of recorded.pages) {
			await client.$executeRaw`INSERT INTO ${Prisma.raw(`\`${page.table}\``)}
				(\`key\`, value, updatedAt) VALUES (${page.key}, ${JSON.stringify(page.value)}, NOW(3))`;
		}
		service = new ScrapedServiceOn(client);
	}, 240_000);

	afterAll(async () => {
		await client?.$disconnect();
		await container?.stop();
	});

	const hashes = (served: Served[] | undefined | null) =>
		(served ?? []).map((r) => r.hash).sort();

	it('shows the Doraemon page every trusted release, the Cyrillic-led filing included', async () => {
		const stored = pageOf('ScrapedTrue', 'movie:tt1613031');
		const filing = stored.filter((r) => isCyrillicLed(r.title!));
		expect(filing.map((r) => r.hash)).toEqual(['3c2ff41cd8bf7188e229238d4e114d5b5ac7dc52']);
		expect(filing[0].title).toMatch(
			/^Дораэмон .*Doraemon Nobita's Great Battle of the Mermaid King/
		);

		const served = await service.getScrapedTrueResults<Served[]>('movie:tt1613031', 0, 0, {
			showCyrillicLed: true,
		});

		expect(served).toHaveLength(11);
		expect(hashes(served)).toEqual(stored.map((r) => r.hash).sort());
	});

	it("shows a Russian series' season page its own releases, every one of them Cyrillic-led", async () => {
		const stored = pageOf('ScrapedTrue', 'tv:tt32059200:10');
		expect(stored.every((r) => isCyrillicLed(r.title!))).toBe(true);

		const served = await service.getScrapedTrueResults<Served[]>('tv:tt32059200:10', 0, 0, {
			showCyrillicLed: true,
		});

		expect(hashes(served)).toEqual(stored.map((r) => r.hash).sort());
	});

	it('keeps dropping Cyrillic-led names from the untrusted table', async () => {
		// 909 of the page's 919 entries are other Russian releases of 2025. The one
		// release of the film is Latin-led and is all that is left.
		const served = await service.getScrapedResults<Served[]>('movie:tt37740754', 0, 0);

		expect(served?.map((r) => r.title)).toEqual([
			'Joto Kando Kolkatatei (2025) 1080p ZEE5 WEB-DL DDP5 1 H 264-D3BP4A mkv',
		]);
	});

	// zurg's search reads this way. The SQL rule and `isCyrillicLed`, which the
	// other automated pickers use, must name the same releases.
	it.each(
		recorded.pages
			.filter((p) => p.table === 'ScrapedTrue' && !p.key.startsWith('anime:'))
			.map((p) => p.key)
	)('leaves out of %s exactly what isCyrillicLed names, unless asked', async (key) => {
		const stored = pageOf('ScrapedTrue', key);

		const served = await service.getScrapedTrueResults<Served[]>(key, 0, 0);

		expect(hashes(served)).toEqual(
			stored
				.filter((r) => !isCyrillicLed(r.title!))
				.map((r) => r.hash)
				.sort()
		);
	});
});
