import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadDump, DumpDownloadFailure } from './download';

// Bun's fetch error when datasets.imdbws.com dropped the title.episode request
// one second in, failing the 2026-10-09 03:26 UTC import on dmm.
const DROPPED = new TypeError(
	'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'
);

const body = (text: string) => new Response(text, { status: 200 });
const noSleep = async () => {};

/** A fetch that plays `steps` in order: an Error is thrown, a Response is returned. */
function scripted(steps: (Error | (() => Response))[]) {
	const calls: string[] = [];
	const fn = (async (url: string) => {
		calls.push(url);
		const step = steps[calls.length - 1];
		if (step instanceof Error) throw step;
		return step();
	}) as unknown as typeof fetch;
	return { fn, calls };
}

let dir: string;
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe('downloadDump', () => {
	it('retries a connection IMDb dropped and keeps the complete file', async () => {
		dir = await mkdtemp(join(tmpdir(), 'imdb-dl-'));
		const path = join(dir, 'title.episode.tsv.gz');
		const { fn, calls } = scripted([DROPPED, () => body('tconst\tparentTconst\n')]);

		const size = await downloadDump('https://datasets.imdbws.com/title.episode.tsv.gz', path, {
			fetch: fn,
			sleep: noSleep,
		});

		expect(calls).toHaveLength(2);
		expect(size).toBe(20);
		expect(await readFile(path, 'utf8')).toBe('tconst\tparentTconst\n');
	});

	it('retries a 503 but gives up after the last attempt', async () => {
		dir = await mkdtemp(join(tmpdir(), 'imdb-dl-'));
		const unavailable = () => new Response('busy', { status: 503 });
		const { fn, calls } = scripted([unavailable, unavailable, unavailable]);

		await expect(
			downloadDump('https://datasets.imdbws.com/x.tsv.gz', join(dir, 'x.tsv.gz'), {
				fetch: fn,
				sleep: noSleep,
				attempts: 3,
			})
		).rejects.toThrow(DumpDownloadFailure);
		expect(calls).toHaveLength(3);
	});

	it('does not retry a 404, which no retry will fix', async () => {
		dir = await mkdtemp(join(tmpdir(), 'imdb-dl-'));
		const { fn, calls } = scripted([() => new Response('missing', { status: 404 })]);

		await expect(
			downloadDump('https://datasets.imdbws.com/x.tsv.gz', join(dir, 'x.tsv.gz'), {
				fetch: fn,
				sleep: noSleep,
			})
		).rejects.toThrow('download answered 404');
		expect(calls).toHaveLength(1);
	});
});
