import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/identified-filenames.json';
import { namedAsMovie } from './identified';

/** content-identifier answering each filename as it did on 2026-10-18. */
function recordedAnswers() {
	const byName = new Map(fixture.items.map((i) => [i.filename, i.identifier]));
	const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
		const { filenames } = JSON.parse(init.body as string) as { filenames: string[] };
		return new Response(JSON.stringify({ results: filenames.map((n) => byName.get(n)) }));
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('namedAsMovie', () => {
	beforeEach(() => vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.test'));
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('keeps exactly the recorded filenames the identifier named as the page movie', async () => {
		recordedAnswers();
		const pages = new Map<string, string[]>();
		for (const item of fixture.items) {
			pages.set(item.imdbId, [...(pages.get(item.imdbId) ?? []), item.filename]);
		}
		const kept = new Set<string>();
		for (const [imdbId, filenames] of pages) {
			for (const name of await namedAsMovie(imdbId, filenames)) kept.add(name);
		}
		const expected = fixture.items.filter((i) => i.identified).map((i) => i.filename);
		expect([...kept].sort()).toEqual([...new Set(expected)].sort());
	});

	it('leaves games and soundtracks named after the film to Jev', async () => {
		recordedAnswers();
		const item = (name: string) => fixture.items.find((i) => i.filename.startsWith(name))!;
		for (const name of [
			'The Da Vinci Code [PS2]',
			'Mission Impossible Iii [2006] [soundtrack]',
		]) {
			const { imdbId, filename } = item(name);
			await expect(namedAsMovie(imdbId, [filename])).resolves.toEqual(new Set());
		}
	});

	it('keeps nothing when the identifier cannot be asked', async () => {
		vi.stubEnv('CONTENT_IDENTIFIER_URL', '');
		const fetchMock = recordedAnswers();
		await expect(namedAsMovie('tt0104431', ['Home.Alone.2.1992.1080p.mkv'])).resolves.toEqual(
			new Set()
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
