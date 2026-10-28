/**
 * Rebuild `wikidata_external_ids` and `wikidata_properties`: every external id
 * Wikidata holds for a film, TV or anime item. Runs weekly from cron on the
 * `dmm` host, which holds the database, through `scripts/wikidata-import/run.sh`.
 *
 *   bun scripts/import-wikidata.ts                     # dry run: fetch and count, write nothing
 *   bun scripts/import-wikidata.ts --props P345,P5091  # dry run of a few properties
 *   bun scripts/import-wikidata.ts --apply             # write
 *
 * Options:
 *   --apply           write; without it nothing is written
 *   --props a,b       only these properties (dry run only: a partial table must not go live)
 *   --delay-ms N      pause between QLever queries (default 250)
 *   --allow-shrink    replace the live tables even with a tenth fewer rows or properties
 *
 * Source: QLever's Wikidata endpoint, which keeps the whole graph and answers
 * the per-property queries in 1-4 s. Wikidata's own query service stops at 60 s
 * and its JSON dump is over 100 GB. QLever stops queries at 30 s, so the import
 * asks one property at a time (`src/services/wikidataImport/wikidataIds.ts`
 * says why each query has its shape). About 1,450 queries, ~40 minutes.
 *
 * Everything is fetched before the database is touched. `--apply` then loads
 * `*_next` copies and renames them over the live tables in one statement, so
 * readers see last week's table or this week's, never a half. Nothing goes
 * live unless every property loaded whole. Every failure exits
 * non-zero with a line starting `FAILED:`.
 */
import { PrismaClient } from '@prisma/client';
import {
	externalIdPropertiesQuery,
	looksTruncated,
	parseExternalIdProperties,
	parsePredicateCounts,
	parsePropertyLabels,
	parsePropertyValues,
	predicateCountsQuery,
	propertyLabelsQuery,
	propertyValuesQuery,
	QLEVER_URL,
	refuseShrink,
	WIKIDATA_IMPORT_USER_AGENT,
	type ExternalIdRow,
	type PropertyLabel,
	type SparqlResults,
} from '../src/services/wikidataImport/wikidataIds';

/** Floor well under the 1,436 properties seen on 2026-10-28; fewer is a broken answer. */
const MIN_PROPERTIES = 1000;
const ATTEMPTS = 4;
/** mysqld took ~45 s to come back from each 2026-10-28 crash. */
const LOAD_ATTEMPTS = 3;
const INSERT_BATCH = 2000;
const IDS = 'wikidata_external_ids';
const PROPS = 'wikidata_properties';

class RunFailure extends Error {}

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(flag: string): string | null {
	const at = process.argv.indexOf(flag);
	return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')
		? process.argv[at + 1]
		: null;
}

async function sparqlOnce(query: string): Promise<SparqlResults> {
	const res = await fetch(QLEVER_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/sparql-results+json',
			'User-Agent': WIKIDATA_IMPORT_USER_AGENT,
		},
		body: new URLSearchParams({ query }),
		signal: AbortSignal.timeout(120_000),
	});
	const text = await res.text();
	let json: any;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`HTTP ${res.status}, not JSON: ${text.slice(0, 200)}`);
	}
	// A query QLever stopped comes back as JSON with `exception` instead of `results`.
	if (!res.ok || !Array.isArray(json?.results?.bindings)) {
		throw new Error(`HTTP ${res.status}: ${String(json?.exception ?? text).slice(0, 200)}`);
	}
	return json;
}

/** `check` throwing counts as a failed attempt too, so a truncated answer is asked again. */
async function sparql<T>(
	label: string,
	query: string,
	check: (json: SparqlResults) => T
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return check(await sparqlOnce(query));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (attempt >= ATTEMPTS) throw new RunFailure(`${label}: ${message}`);
			const wait = 15_000 * attempt;
			console.error(
				`${new Date().toISOString()} ${label} attempt ${attempt}: ${message}; retry in ${wait / 1000}s`
			);
			await sleep(wait);
		}
	}
}

interface LoadedProperty {
	prop: string;
	items: number;
	rows: ExternalIdRow[];
}

/**
 * Load everything into `*_next` and rename it live. Nothing here talks to
 * QLever, so the phase lasts minutes and can start over when mysqld drops the
 * connection (it restarted every 10-20 min on 2026-10-28).
 */
async function load(
	prisma: PrismaClient,
	loaded: LoadedProperty[],
	labels: Map<string, PropertyLabel>,
	total: number
): Promise<void> {
	await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${IDS}_next, ${PROPS}_next`);
	await prisma.$executeRawUnsafe(`CREATE TABLE ${IDS}_next LIKE ${IDS}`);
	await prisma.$executeRawUnsafe(`CREATE TABLE ${PROPS}_next LIKE ${PROPS}`);

	for (const { prop, rows } of loaded) {
		for (let i = 0; i < rows.length; i += INSERT_BATCH) {
			const batch = rows.slice(i, i + INSERT_BATCH);
			await prisma.$executeRawUnsafe(
				`INSERT INTO ${IDS}_next (qid, prop, value) VALUES ${batch.map(() => '(?,?,?)').join(',')}`,
				...batch.flatMap((r) => [r.qid, prop, r.value])
			);
		}
	}
	for (let i = 0; i < loaded.length; i += 500) {
		const batch = loaded.slice(i, i + 500);
		await prisma.$executeRawUnsafe(
			`INSERT INTO ${PROPS}_next (prop, label, formatter_url, items, row_count) VALUES ${batch
				.map(() => '(?,?,?,?,?)')
				.join(',')}`,
			...batch.flatMap((p) => [
				p.prop,
				labels.get(p.prop)?.label ?? null,
				labels.get(p.prop)?.formatterUrl ?? null,
				p.items,
				p.rows.length,
			])
		);
	}

	const [written] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
		`SELECT COUNT(*) AS n FROM ${IDS}_next`
	);
	if (Number(written.n) !== total) {
		throw new RunFailure(`${IDS}_next holds ${written.n} rows, ${total} were inserted`);
	}
	const [live] = await prisma.$queryRawUnsafe<{ rows: unknown; props: bigint }[]>(
		`SELECT COALESCE(SUM(row_count), 0) AS \`rows\`, COUNT(*) AS props FROM ${PROPS}`
	);
	const before = { rows: Number(live.rows), props: Number(live.props) };
	const refusal = refuseShrink(before, { rows: total, props: loaded.length });
	if (refusal && !process.argv.includes('--allow-shrink')) {
		throw new RunFailure(`${refusal}; --allow-shrink replaces them anyway`);
	}

	await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${IDS}_old, ${PROPS}_old`);
	await prisma.$executeRawUnsafe(
		`RENAME TABLE ${IDS} TO ${IDS}_old, ${IDS}_next TO ${IDS}, ${PROPS} TO ${PROPS}_old, ${PROPS}_next TO ${PROPS}`
	);
	await prisma.$executeRawUnsafe(`DROP TABLE ${IDS}_old, ${PROPS}_old`);
	log(
		`Live: ${total} rows over ${loaded.length} properties ` +
			`(was ${before.rows} over ${before.props})`
	);
}

async function main(prisma: PrismaClient): Promise<void> {
	const apply = process.argv.includes('--apply');
	const only = argValue('--props')?.split(',');
	const delayMs = Number(argValue('--delay-ms') ?? 250);
	if (apply && only)
		throw new RunFailure('--props is for dry runs; a partial table must not go live');
	if (!Number.isFinite(delayMs) || delayMs < 0) throw new RunFailure('--delay-ms needs a number');

	log(`wikidata import ${apply ? 'APPLY' : 'dry run'}`);
	const externalIds = await sparql(
		'external-id properties',
		externalIdPropertiesQuery,
		(json) => {
			const props = parseExternalIdProperties(json);
			if (props.size < 5000) throw new Error(`only ${props.size} external-id properties`);
			return props;
		}
	);
	let props = await sparql('predicate counts', predicateCountsQuery, (json) => {
		const counts = parsePredicateCounts(json, externalIds);
		if (counts.length < MIN_PROPERTIES)
			throw new Error(`only ${counts.length} properties in use`);
		return counts;
	});
	log(`${props.length} external-id properties on media items, of ${externalIds.size}`);
	if (only) props = props.filter((p) => only.includes(p.prop));

	const loaded: LoadedProperty[] = [];
	let total = 0;
	let tooLong = 0;
	for (const [n, { prop, items: indexed }] of props.entries()) {
		const parsed = await sparql(prop, propertyValuesQuery(prop), (json) => {
			const values = parsePropertyValues(json);
			if (looksTruncated(values.items, indexed)) {
				throw new Error(`${values.items} items, the index counts ${indexed}`);
			}
			return values;
		});
		loaded.push({ prop, items: parsed.items, rows: parsed.rows });
		total += parsed.rows.length;
		tooLong += parsed.tooLong;
		if (parsed.tooLong) log(`${prop}: ${parsed.tooLong} values over 255 characters left out`);
		if ((n + 1) % 100 === 0 || n + 1 === props.length) {
			log(`${n + 1}/${props.length} properties, ${total} rows`);
		}
		await sleep(delayMs);
	}

	const labels = new Map<string, PropertyLabel>();
	for (let i = 0; i < loaded.length; i += 500) {
		const chunk = loaded.slice(i, i + 500).map((p) => p.prop);
		for (const label of await sparql(
			'labels',
			propertyLabelsQuery(chunk),
			parsePropertyLabels
		)) {
			labels.set(label.prop, label);
		}
	}
	log(`Fetched ${total} rows over ${loaded.length} properties, ${tooLong} values too long`);
	for (const p of [...loaded].sort((a, b) => b.rows.length - a.rows.length).slice(0, 15)) {
		console.log(
			`  ${p.prop.padEnd(8)} ${String(p.rows.length).padStart(8)}  ${labels.get(p.prop)?.label ?? ''}`
		);
	}

	if (!apply) {
		log('Dry run: nothing written. Re-run with --apply to write.');
		return;
	}
	for (let attempt = 1; ; attempt++) {
		try {
			return await load(prisma, loaded, labels, total);
		} catch (error) {
			if (error instanceof RunFailure || attempt >= LOAD_ATTEMPTS) throw error;
			const message = error instanceof Error ? error.message.trim().split('\n').pop() : error;
			console.error(
				`${new Date().toISOString()} load attempt ${attempt}: ${message}; starting over in 90s`
			);
			await sleep(90_000);
		}
	}
}

const prisma = new PrismaClient();
main(prisma)
	.catch(async (error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${new Date().toISOString()} FAILED: ${message}`);
		if (!(error instanceof RunFailure) && error instanceof Error && error.stack) {
			console.error(error.stack);
		}
		process.exitCode = 1;
		// The live tables are untouched; only the half-loaded copies go.
		if (process.argv.includes('--apply')) {
			await prisma
				.$executeRawUnsafe(`DROP TABLE IF EXISTS ${IDS}_next, ${PROPS}_next`)
				.catch(() => {});
		}
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
