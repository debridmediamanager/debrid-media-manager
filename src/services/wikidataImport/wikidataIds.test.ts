import externalIds from '@/test/fixtures/wikidata/external-id-properties-2026-10-28.json';
import hancinema from '@/test/fixtures/wikidata/hancinema-drama-P5091-2026-10-28.json';
import counts from '@/test/fixtures/wikidata/predicate-counts-2026-10-28.json';
import labels from '@/test/fixtures/wikidata/property-labels-2026-10-28.json';
import { describe, expect, it } from 'vitest';
import {
	looksTruncated,
	parseExternalIdProperties,
	parsePredicateCounts,
	parsePropertyLabels,
	parsePropertyValues,
	propertyValuesQuery,
	refuseShrink,
	type SparqlResults,
} from './wikidataIds';

// QLever's answers to these queries on 2026-10-28, trimmed to a few
// properties except the HanCinema drama one, which is whole.

describe('parsePredicateCounts', () => {
	it('keeps only external-id properties, largest first', () => {
		const ext = parseExternalIdProperties(externalIds as SparqlResults);
		expect(ext.has('P345')).toBe(true);
		expect(ext.has('P31')).toBe(false);

		// P31 (instance of) and schema:description are in the answer but are not ids.
		expect(parsePredicateCounts(counts as SparqlResults, ext)).toEqual([
			{ prop: 'P345', items: 570623 },
			{ prop: 'P11460', items: 236073 },
			{ prop: 'P3704', items: 5049 },
			{ prop: 'P5108', items: 1997 },
			{ prop: 'P5091', items: 1499 },
		]);
	});
});

describe('parsePropertyValues', () => {
	it('reads every HanCinema drama id with its item, sorted by value', () => {
		const parsed = parsePropertyValues(hancinema as SparqlResults);
		expect(parsed.rows).toHaveLength(1513);
		expect(parsed.items).toBe(1513);
		expect(parsed.tooLong).toBe(0);
		expect(parsed.rows).toContainEqual({ qid: 100231189, value: 'Delayed_Justice' });
		const values = parsed.rows.map((r) => r.value);
		expect(values).toEqual([...values].sort());
	});

	it('drops repeated pairs and values too long for the column, keeping the item count', () => {
		const binding = (q: string, v: string) => ({
			item: { type: 'uri', value: `http://www.wikidata.org/entity/${q}` },
			v: { type: 'literal', value: v },
		});
		const parsed = parsePropertyValues({
			results: {
				bindings: [
					binding('Q2', 'b'),
					binding('Q1', 'a'),
					binding('Q1', 'a'),
					binding('Q3', 'x'.repeat(256)),
					{
						item: { type: 'uri', value: 'http://www.wikidata.org/entity/L5' },
						v: binding('Q1', 'c').v,
					},
				],
			},
		});
		expect(parsed.rows).toEqual([
			{ qid: 1, value: 'a' },
			{ qid: 2, value: 'b' },
		]);
		expect(parsed.items).toBe(3);
		expect(parsed.tooLong).toBe(1);
	});
});

describe('looksTruncated', () => {
	// Full fetches measured 2026-10-28 against the has-predicate index's count:
	// P5091 1,513 vs 1,499, and P14509 (Beeld & Geluid) 2,753 vs 2,819, which
	// failed the first full run under a 2% tolerance.
	it('accepts full answers on either side of the index count and refuses a gross shortfall', () => {
		expect(looksTruncated(1513, 1499)).toBe(false);
		expect(looksTruncated(2753, 2819)).toBe(false);
		expect(looksTruncated(1000, 1499)).toBe(true);
		expect(looksTruncated(0, 1)).toBe(true);
	});
});

describe('parsePropertyLabels', () => {
	it('reads the label and formatter URL', () => {
		const parsed = parsePropertyLabels(labels as SparqlResults);
		expect(parsed).toContainEqual({
			prop: 'P11460',
			label: 'Plex media key',
			formatterUrl:
				'https://app.plex.tv/desktop/#!/provider/tv.plex.provider.metadata/details?key=/library/metadata/$1',
		});
	});
});

describe('propertyValuesQuery', () => {
	it('refuses anything but a property id', () => {
		expect(propertyValuesQuery('P345')).toContain('wdt:P345 ?v');
		expect(() => propertyValuesQuery('P345 ?x }')).toThrow();
	});
});

describe('refuseShrink', () => {
	it('lets a first run or a small change through and refuses a large loss', () => {
		expect(refuseShrink({ rows: 0, props: 0 }, { rows: 7_000_000, props: 1436 })).toBeNull();
		expect(
			refuseShrink({ rows: 7_000_000, props: 1436 }, { rows: 6_950_000, props: 1430 })
		).toBeNull();
		expect(
			refuseShrink({ rows: 7_000_000, props: 1436 }, { rows: 4_000_000, props: 1436 })
		).toMatch(/rows/);
		expect(
			refuseShrink({ rows: 7_000_000, props: 1436 }, { rows: 7_000_000, props: 900 })
		).toMatch(/properties/);
	});
});
