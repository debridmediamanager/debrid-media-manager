import { fanOut, Indexer } from '@/services/nzb2rd';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Two upstream indexers answered DMM's `t=search&o=json&extended=1` with Newznab
// RSS XML on 2026-11-07, ignoring `o=json`. Bodies captured from DMM's server with
// the API key redacted and the indexer names replaced. Indexer A's guid is the full
// `t=get` URL, key included; indexer B's guid is the bare id.
const fixture = (name: string) =>
	readFileSync(join(process.cwd(), 'src/test/fixtures/newznab', name), 'utf8');
const indexerA = fixture('xml-only-indexer-a-search-2026-11-07.xml');
const indexerB = fixture('xml-only-indexer-b-search-2026-11-07.xml');

const upstream = (prefix: string): Indexer => ({
	prefix,
	name: `Indexer ${prefix}`,
	url: `https://${prefix}.example/api`,
	apiKey: 'k',
});

function answer(body: string, contentType = 'application/xml; charset=UTF-8') {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(body, { status: 200, headers: { 'content-type': contentType } })
	);
}

afterEach(() => vi.restoreAllMocks());

describe('an upstream that answers Newznab XML instead of JSON', () => {
	it('is read, not counted as a failure', async () => {
		answer(indexerA);
		const { ok, lists, answered } = await fanOut(() => 'https://xa.example/api', 'search', [
			upstream('xa'),
		]);
		expect(ok).toBe(true);
		expect(answered).toEqual([true]);
		expect(lists[0]).toHaveLength(3);
		expect(lists[0][0]).toMatchObject({
			id: 'xa:177872480',
			title: 'Sousou no Frieren S01 [1080p VVC xHE-AAC]',
			size: 6421905316,
			category: ['5070'],
			indexer: 'Indexer xa',
		});
		expect(lists[0][0].pubDate).toBeTruthy();
	});

	it('takes the release id out of a t=get guid URL and never keeps the key', async () => {
		answer(indexerA);
		const { lists } = await fanOut(() => 'https://xa.example/api', 'search', [upstream('xa')]);
		for (const r of lists[0]) {
			expect(r.id).toMatch(/^xa:\d+$/);
			expect(r.id).not.toContain('apikey');
		}
	});

	it('reads bare-id guids and decodes entities in titles', async () => {
		answer(indexerB);
		const { lists } = await fanOut(() => 'https://xb.example/api', 'search', [upstream('xb')]);
		expect(lists[0]).toHaveLength(3);
		expect(lists[0][0].id).toBe('xb:artifact_abb885b50501fcac1d310056');
		expect(lists[0][0].size).toBe(6774925994);
		expect(lists[0][0].title).toContain("Frieren: Beyond Journey's End");
		expect(lists[0][0].category).toEqual(['5070']);
	});

	it('still reports an XML error envelope as a failure, naming the error', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		answer(
			'<?xml version="1.0"?>\n<error code="100" description="Incorrect user credentials"/>'
		);
		const { ok, answered } = await fanOut(() => 'https://xa.example/api', 'search', [
			upstream('xa'),
		]);
		expect(ok).toBe(false);
		expect(answered).toEqual([false]);
		expect(String(logged.mock.calls[0][1])).toContain('Incorrect user credentials (code 100)');
	});
});
