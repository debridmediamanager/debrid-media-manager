// @vitest-environment node
import corpus from '@/test/fixtures/mediaType/release-names-2026-11-14.json';
import { convertToUserTorrent } from '@/utils/fetchTorrents';
import { filenameParse } from '@/utils/filenameParse';
import { describe, expect, it } from 'vitest';
import { getTypeByName, getTypeByNameAndFileCount } from './mediaType';

type Entry = {
	name: string;
	type: 'movie' | 'tv';
	title?: string;
	year?: string;
	seasons?: number[];
	episodes?: number[];
};

describe('recorded release names (fixtures/mediaType)', () => {
	it.each(corpus.names as Entry[])('$name', ({ name, type, title, year, seasons, episodes }) => {
		expect(getTypeByName(name)).toBe(type);
		expect(getTypeByNameAndFileCount(name)).toBe(type);
		const info = filenameParse(name, type === 'tv') as Record<string, any>;
		if (title !== undefined) expect(info.title).toBe(title);
		if (year !== undefined) expect(info.year).toBe(year);
		if (seasons) expect(info.seasons ?? []).toEqual(seasons);
		if (episodes) expect(info.episodeNumbers ?? []).toEqual(episodes);
	});
});

describe('library rows', () => {
	const row = (filename: string) =>
		convertToUserTorrent({
			id: 'X',
			filename,
			bytes: 1,
			status: 'downloaded',
			added: '2026-11-14T00:00:00.000Z',
			links: [],
		} as any);

	it('names the archive.org Big Buck Bunny as the 2008 film, not S01E60', () => {
		const bunny = row('big-buck-bunny-2008-4k-60fps');
		expect(bunny.mediaType).toBe('movie');
		expect(bunny.title).toBe('big-buck-bunny (2008)');
	});

	it('reads a season pack with a frame rate as the season', () => {
		expect(row('Formula.1.Drive.to.Survive.S05.1080p.h265.50fps.atmos.d2t').title).toBe(
			'Formula 1 Drive to Survive ➡️ S05'
		);
	});
});
