import type { UserTorrent } from '@/torrent/userTorrent';
import { describe, expect, it, vi } from 'vitest';
import { IDENTIFY_BATCH, identifiable, identifyLibrary } from './libraryIdentify';

const torrent = (id: string, filename: string, mediaType: UserTorrent['mediaType'] = 'movie') =>
	({ id, filename, hash: `${id}hash`, mediaType }) as unknown as UserTorrent;

describe('identifiable', () => {
	it('takes movies with a real release name only', () => {
		expect(identifiable(torrent('rd:1', 'Mad.Max.Fury.Road.2015.2160p'))).toBe(true);
		expect(identifiable(torrent('rd:2', 'Show.S01.1080p', 'tv'))).toBe(false);
		expect(identifiable(torrent('rd:3', 'Magnet'))).toBe(false);
		const magnet = torrent('rd:4', '');
		expect(identifiable({ ...magnet, filename: magnet.hash } as UserTorrent)).toBe(false);
	});
});

describe('identifyLibrary', () => {
	it('batches, maps answers back to library ids and skips a failed batch', async () => {
		const items = Array.from({ length: IDENTIFY_BATCH + 2 }, (_, i) =>
			torrent(`rd:${i}`, `M.${i}.2020`)
		);
		let call = 0;
		const post = vi.fn(async (_url: string, init: RequestInit) => {
			call += 1;
			const { items: sent } = JSON.parse(init.body as string) as {
				items: { filename: string }[];
			};
			if (call === 2) return new Response('busy', { status: 429 });
			return new Response(
				JSON.stringify({
					results: sent.map((s, i) =>
						i === 0 ? { imdbId: 'tt0000001', title: s.filename, year: 2020 } : null
					),
				})
			);
		});

		const found = await identifyLibrary(items, post as unknown as typeof fetch);

		expect(post).toHaveBeenCalledTimes(2);
		expect(found).toEqual({ 'rd:0': { imdbId: 'tt0000001', title: 'M.0.2020', year: 2020 } });
		const firstBody = JSON.parse(post.mock.calls[0][1].body as string);
		expect(firstBody.items[0]).toEqual({ filename: 'M.0.2020', hash: 'rd:0hash' });
	});
});
