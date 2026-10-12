import type { UserTorrent } from '@/torrent/userTorrent';
import { describe, expect, it, vi } from 'vitest';
import { IDENTIFY_BATCH, identifiable, identifyLibrary } from './libraryIdentify';

const torrent = (id: string, filename: string, mediaType: UserTorrent['mediaType'] = 'movie') =>
	({ id, filename, hash: `${id}hash`, mediaType }) as unknown as UserTorrent;

const answer = (filename: string) => ({
	imdbId: 'tt0000001',
	title: filename,
	year: 2020,
	kind: 'movie',
});

describe('identifiable', () => {
	it('takes movies and shows with a real release name only', () => {
		expect(identifiable(torrent('rd:1', 'Mad.Max.Fury.Road.2015.2160p'))).toBe(true);
		expect(identifiable(torrent('rd:2', 'Show.S01.1080p', 'tv'))).toBe(true);
		expect(identifiable(torrent('rd:5', 'Some.Album.FLAC', 'other'))).toBe(false);
		expect(identifiable(torrent('rd:3', 'Magnet'))).toBe(false);
		const magnet = torrent('rd:4', '');
		expect(identifiable({ ...magnet, filename: magnet.hash } as UserTorrent)).toBe(false);
	});
});

describe('identifyLibrary', () => {
	const respond = (init: RequestInit, pick: (i: number) => boolean) => {
		const { items } = JSON.parse(init.body as string) as { items: { filename: string }[] };
		return new Response(
			JSON.stringify({ results: items.map((s, i) => (pick(i) ? answer(s.filename) : null)) })
		);
	};

	it('hands over each batch as it lands and skips a batch that fails', async () => {
		const items = Array.from({ length: IDENTIFY_BATCH + 2 }, (_, i) =>
			torrent(`rd:${i}`, `M.${i}.2020`)
		);
		let call = 0;
		const post = vi.fn(async (_url: string, init: RequestInit) => {
			call += 1;
			if (call === 2) return new Response('boom', { status: 500 });
			return respond(init, (i) => i === 0);
		});
		const onFound = vi.fn();

		await identifyLibrary(items, onFound, post as unknown as typeof fetch);

		expect(post).toHaveBeenCalledTimes(2);
		expect(onFound).toHaveBeenCalledExactlyOnceWith({ 'rd:0': answer('M.0.2020') });
		// the service decides movie or show; the library's guess is not sent
		expect(JSON.parse(post.mock.calls[0][1].body as string).items[0]).toEqual({
			filename: 'M.0.2020',
			hash: 'rd:0hash',
		});
	});

	// ymsita's 6,295-release library: the 11th batch in a minute was refused and,
	// before this, silently dropped, so ~1,300 rows were never named (2026-10-11)
	it('waits out a rate-limit refusal and asks for the same batch again', async () => {
		const items = [torrent('rd:1', 'Mad.Max.Fury.Road.2015')];
		const refused = new Response(null, { status: 429, headers: { 'Retry-After': '42' } });
		const post = vi
			.fn()
			.mockResolvedValueOnce(refused)
			.mockImplementationOnce(async (_url: string, init: RequestInit) =>
				respond(init, () => true)
			);
		const wait = vi.fn(async () => undefined);
		const onFound = vi.fn();

		await identifyLibrary(items, onFound, post as unknown as typeof fetch, wait);

		expect(wait).toHaveBeenCalledExactlyOnceWith(42_000);
		expect(post).toHaveBeenCalledTimes(2);
		expect(onFound).toHaveBeenCalledWith({ 'rd:1': answer('Mad.Max.Fury.Road.2015') });
	});

	it('gives a batch up after repeated refusals', async () => {
		const post = vi.fn(async () => new Response(null, { status: 429 }));
		const wait = vi.fn(async () => undefined);
		await identifyLibrary(
			[torrent('rd:1', 'X.2020')],
			vi.fn(),
			post as unknown as typeof fetch,
			wait
		);
		expect(post).toHaveBeenCalledTimes(5);
		expect(wait).toHaveBeenCalledWith(10_000);
	});
});
