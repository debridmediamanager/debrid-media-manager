import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ANIME_OFFLINE_DATABASE_URL,
	getAnimeSynonyms,
	namesOfLine,
	resetAnimeSynonymsForTests,
} from './animeSynonyms';

// Three lines of manami's anime-offline-database (release 2026-27), as published.
const excerpt = fs.readFileSync(
	path.join(__dirname, '../../test/fixtures/placement/anime-offline-database-excerpt.jsonl'),
	'utf8'
);

/** A fetch answering the excerpt in small chunks, so lines arrive split across reads. */
function streaming(text: string) {
	return vi.fn(async () => {
		const bytes = new TextEncoder().encode(text);
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (let at = 0; at < bytes.length; at += 997) {
					controller.enqueue(bytes.slice(at, at + 997));
				}
				controller.close();
			},
		});
		return new Response(body, { status: 200 });
	});
}

describe('anime-offline-database synonyms', () => {
	afterEach(() => resetAnimeSynonymsForTests());

	it('reads the names fansub releases use, which AniDB titles alone lack', () => {
		const entry = excerpt
			.split('\n')
			.map(namesOfLine)
			.find((e) => e?.anidbIds.includes(11850))!;
		expect(entry.anidbIds).toEqual([11850]);
		// `[Holomux] Gintama° Love Potion Arc`
		expect(entry.names).toContain('Gintama: Love Potion Arc');
		expect(namesOfLine('{"$schema":"…"}')).toBeNull();
		expect(namesOfLine('not json')).toBeNull();
	});

	it('streams the dataset once a week and keeps only the entries asked for', async () => {
		const fetcher = streaming(excerpt);
		const names = await getAnimeSynonyms((id) => id === 6153, fetcher as never);
		expect(fetcher).toHaveBeenCalledWith(ANIME_OFFLINE_DATABASE_URL, expect.anything());
		expect([...names!.keys()]).toEqual([6153]);
		// `[SZN & I-O] Hajime no Ippo New Challenger`: AniDB calls it `The Fighting! - New Challenger`
		expect(names!.get(6153)).toContain('Hajime no Ippo: New Challenger');
		await getAnimeSynonyms(() => true, fetcher as never);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('answers null until a download has worked', async () => {
		const failing = vi.fn(async () => new Response('', { status: 503 }));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await getAnimeSynonyms(() => true, failing as never)).toBeNull();
	});
});
