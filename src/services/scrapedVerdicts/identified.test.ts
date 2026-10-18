import { forgetIdentifications } from '@/services/contentIdentifier';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/identified-filenames.json';
import { identifiedAnswers } from './identified';
import { decide, type MovieContext } from './rules';

const movies = fixture.movies as unknown as Record<string, MovieContext>;
const item = (prefix: string) => fixture.items.find((i) => i.filename.startsWith(prefix))!;

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

async function verdictFor(i: (typeof fixture.items)[number]) {
	const movie = movies[i.imdbId];
	const answer = (await identifiedAnswers(movie, [i.filename])).answers.get(i.filename);
	return answer
		? { ...answer, verdict: decide(movie, i.filename, answer.media, answer.titleMatch) }
		: null;
}

describe('identifiedAnswers', () => {
	beforeEach(() => {
		forgetIdentifications();
		vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.test');
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('answers the recorded production filenames as expected', async () => {
		recordedAnswers();
		for (const i of fixture.items) {
			expect([i.filename, await verdictFor(i)]).toEqual([i.filename, i.expected]);
		}
	});

	it('overrules Jev wrongly only on the six releases found by hand', async () => {
		const wrong = fixture.items.filter((i) => i.right === 'jev').map((i) => i.filename);
		const right = fixture.items.filter((i) => i.right === 'identifier');
		expect(wrong).toHaveLength(6);
		expect(right).toHaveLength(33);
	});

	it('trashes another film that carries the movie title', async () => {
		recordedAnswers();
		await expect(verdictFor(item('Old.Henry.2021'))).resolves.toMatchObject({
			verdict: 'trash',
		});
	});

	it('keeps a set that holds the movie although the identifier names another film', async () => {
		recordedAnswers();
		const sets = fixture.items.filter(
			(i) => i.expected?.titleMatch !== 'SAME_TITLE' && i.expected?.verdict === 'keep'
		);
		expect(sets.map((i) => i.filename)).toContain(item('Kill Bill duology').filename);
	});

	it('leaves to Jev the films sharing the movie title, games and numbers read as titles', async () => {
		recordedAnswers();
		for (const prefix of [
			'deadpool.mkv',
			'Traffic (2000)',
			'Super Mario Galaxy 2 [PAL][Wii]',
			'Mission Impossible Iii [2006] [soundtrack]',
			'2008.myHD.Taken',
			'Монстры на каникулах',
		]) {
			await expect(verdictFor(item(prefix))).resolves.toBeNull();
		}
	});

	it('answers nothing when the identifier cannot be asked', async () => {
		vi.stubEnv('CONTENT_IDENTIFIER_URL', '');
		const fetchMock = recordedAnswers();
		await expect(verdictFor(item('Old.Henry.2021'))).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
