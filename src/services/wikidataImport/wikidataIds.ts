/**
 * Every external id Wikidata holds for films, TV and anime, read from QLever's
 * Wikidata endpoint. `scripts/import-wikidata.ts` runs it and says why QLever.
 */

export const QLEVER_URL = 'https://qlever.dev/api/wikidata';
export const WIKIDATA_IMPORT_USER_AGENT =
	'dmm-wikidata-import/1.0 (+https://debridmediamanager.com)';

/**
 * What counts as a film or TV item: an instance of one of these classes or of
 * any subclass. Measured 2026-10-28: the first six hold 822k items; the rest
 * are the anime, web and TV shapes those six missed that carry an IMDb, TMDB,
 * TVDB, AniDB, MyAnimeList or AniList id. Video games (9.6k with IMDb ids) are
 * left out on purpose.
 */
export const MEDIA_ROOT_CLASSES = [
	'Q11424', // film
	'Q15416', // television program
	'Q5398426', // television series
	'Q21191270', // television series episode
	'Q3464665', // television series season
	'Q1259759', // miniseries
	'Q526877', // web series
	'Q1464125', // web series episode
	'Q24856', // film series
	'Q21664088', // two-part episode
	'Q1047299', // original net animation
	'Q1107', // anime
	'Q846662', // game show
	'Q622812', // talk show
	'Q17317604', // professional wrestling event
] as const;

const PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ql: <http://qlever.cs.uni-freiburg.de/builtin-functions/>`;

const MEDIA_ITEMS = `{ SELECT DISTINCT ?item WHERE {
	VALUES ?root { ${MEDIA_ROOT_CLASSES.map((q) => `wd:${q}`).join(' ')} }
	?item wdt:P31/wdt:P279* ?root } }`;

const PROP = /^P[1-9][0-9]*$/;

function assertProp(prop: string): void {
	if (!PROP.test(prop)) throw new Error(`not a property id: ${prop}`);
}

/** Every property of type external id, used to keep only ids out of `predicateCountsQuery`. */
export const externalIdPropertiesQuery = `${PREFIXES}
SELECT ?p WHERE { ?p wikibase:propertyType wikibase:ExternalId }`;

/**
 * How many media items carry each predicate. QLever answers this from its
 * has-predicate index in seconds; grouping `?item ?wdt ?v` instead times out.
 */
export const predicateCountsQuery = `${PREFIXES}
SELECT ?pred (COUNT(?item) AS ?items) WHERE { ${MEDIA_ITEMS} ?item ql:has-predicate ?pred } GROUP BY ?pred`;

/**
 * One property's values on media items. One property per query: a VALUES list
 * of predicates makes QLever sort the whole predicate column and time out.
 */
export function propertyValuesQuery(prop: string): string {
	assertProp(prop);
	return `${PREFIXES}
SELECT ?item ?v WHERE { ?item wdt:${prop} ?v . ${MEDIA_ITEMS} }`;
}

/** English label and one formatter URL per property, for reading the table. */
export function propertyLabelsQuery(props: string[]): string {
	props.forEach(assertProp);
	return `${PREFIXES}
SELECT ?p (SAMPLE(?l) AS ?label) (SAMPLE(?f) AS ?formatter) WHERE {
	VALUES ?p { ${props.map((p) => `wd:${p}`).join(' ')} }
	OPTIONAL { ?p rdfs:label ?l FILTER(LANG(?l) = "en") }
	OPTIONAL { ?p wdt:P1630 ?f } } GROUP BY ?p`;
}

interface SparqlTerm {
	type: string;
	value: string;
}
export interface SparqlResults {
	results: { bindings: Record<string, SparqlTerm | undefined>[] };
}

const ENTITY = 'http://www.wikidata.org/entity/';
const DIRECT = 'http://www.wikidata.org/prop/direct/';

function idAfter(prefix: string, term: SparqlTerm | undefined): string | null {
	return term?.type === 'uri' && term.value.startsWith(prefix)
		? term.value.slice(prefix.length)
		: null;
}

export function parseExternalIdProperties(json: SparqlResults): Set<string> {
	const props = new Set<string>();
	for (const b of json.results.bindings) {
		const p = idAfter(ENTITY, b.p);
		if (p && PROP.test(p)) props.add(p);
	}
	return props;
}

/** External-id properties on media items with how many items carry each, largest first. */
export function parsePredicateCounts(
	json: SparqlResults,
	externalIds: Set<string>
): { prop: string; items: number }[] {
	const counts: { prop: string; items: number }[] = [];
	for (const b of json.results.bindings) {
		const prop = idAfter(DIRECT, b.pred);
		if (prop && externalIds.has(prop)) counts.push({ prop, items: Number(b.items?.value) });
	}
	return counts.sort((a, b) => b.items - a.items || a.prop.localeCompare(b.prop));
}

/** Longest value the table's `value` column takes. */
export const MAX_VALUE_LENGTH = 255;

export interface ExternalIdRow {
	qid: number;
	value: string;
}

/**
 * One property's rows, sorted by value so inserts follow the primary key.
 * `items` is how many distinct items came back, checked against the
 * has-predicate count to catch a truncated answer.
 */
export function parsePropertyValues(json: SparqlResults): {
	rows: ExternalIdRow[];
	items: number;
	tooLong: number;
} {
	const rows: ExternalIdRow[] = [];
	const items = new Set<number>();
	let tooLong = 0;
	for (const b of json.results.bindings) {
		const q = idAfter(ENTITY, b.item);
		const value = b.v?.type === 'literal' ? b.v.value : null;
		if (!q || !/^Q[1-9][0-9]*$/.test(q) || value === null) continue;
		const qid = Number(q.slice(1));
		items.add(qid);
		if (value.length > MAX_VALUE_LENGTH) tooLong++;
		else rows.push({ qid, value });
	}
	rows.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : a.qid - b.qid));
	const unique = rows.filter(
		(r, i) => i === 0 || r.value !== rows[i - 1].value || r.qid !== rows[i - 1].qid
	);
	return { rows: unique, items: items.size, tooLong };
}

/**
 * Whether a property's answer came back short. A full fetch returns at least
 * the has-predicate index's count (measured 2026-10-28, always a little more),
 * so far fewer means QLever cut the answer off.
 */
export function looksTruncated(fetchedItems: number, indexedItems: number): boolean {
	return fetchedItems < indexedItems * 0.98;
}

export interface PropertyLabel {
	prop: string;
	label: string | null;
	formatterUrl: string | null;
}

export function parsePropertyLabels(json: SparqlResults): PropertyLabel[] {
	const labels: PropertyLabel[] = [];
	for (const b of json.results.bindings) {
		const prop = idAfter(ENTITY, b.p);
		if (!prop || !PROP.test(prop)) continue;
		const formatter = b.formatter?.value ?? null;
		labels.push({
			prop,
			label: b.label?.value.slice(0, 255) ?? null,
			formatterUrl: formatter && formatter.length <= 512 ? formatter : null,
		});
	}
	return labels;
}

/**
 * Why a finished fetch must not replace the live table, or null when it may.
 * A run that lost a tenth of its rows or properties is a broken fetch far more
 * often than Wikidata deleting that much in a week.
 */
export function refuseShrink(
	before: { rows: number; props: number },
	after: { rows: number; props: number },
	minShare = 0.9
): string | null {
	if (after.rows < before.rows * minShare) {
		return `${after.rows} rows is under ${minShare} of the ${before.rows} live`;
	}
	if (after.props < before.props * minShare) {
		return `${after.props} properties is under ${minShare} of the ${before.props} live`;
	}
	return null;
}
