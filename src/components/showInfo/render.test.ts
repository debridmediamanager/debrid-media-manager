import { describe, expect, it } from 'vitest';

import { renderTorrentInfo, renderTorrentInfoTB } from './render';

const baseFile = {
	id: 1,
	path: 'Example.mkv',
	bytes: 1024,
	selected: 1,
};

const rdInfo = {
	id: '1',
	hash: 'hash-123',
	status: 'downloaded',
	fake: false,
	files: [baseFile],
	links: ['https://real-debrid.com/link'],
	progress: 100,
	bytes: 1024,
	filename: 'Example.mkv',
};

describe('renderTorrentInfo', () => {
	it('adds hidden inputs for watch and cast actions', () => {
		const html = renderTorrentInfo(
			{ ...rdInfo },
			true,
			'rd-token',
			'mac2',
			'tt1234567',
			'movie'
		);

		expect(html).toContain('action="/api/watch/mac2"');
		expect(html).toContain('name="token" value="rd-token"');
		expect(html).toContain('name="hash" value="hash-123"');
		expect(html).toContain('name="link" value="https://real-debrid.com/link"');
		expect(html).toContain('action="/api/stremio/cast/tt1234567"');
		expect(html).toContain('name="fileId" value="1"');
		expect(html).toContain('name="mediaType" value="movie"');
	});

	it('adds hidden inputs for instant watch when torrent is fake', () => {
		const fakeInfo = {
			...rdInfo,
			fake: true,
			links: [],
		};
		const html = renderTorrentInfo(fakeInfo, true, 'rd-token', 'mac2', 'tt1234567', 'movie');

		expect(html).toContain('action="/api/watch/instant/mac2"');
		expect(html).toContain('name="fileId" value="1"');
		// A fake info object is built from search results, whose file ids may
		// belong to another service's listing, so the name has to travel too.
		expect(html).toContain('name="fileName" value="Example.mkv"');
		expect(html).toContain('name="service" value="rd"');
	});

	describe('AllDebrid rows', () => {
		const adInfo = {
			links: [
				{ filename: 'Example.mkv', link: 'https://alldebrid.com/f/abc', size: 2048 },
				{ filename: 'notes.txt', link: 'https://alldebrid.com/f/def', size: 12 },
			],
		};

		it('offers a watch button that unlocks the row link', () => {
			const html = renderTorrentInfo({ ...adInfo }, false, 'ad-key', 'mac2', 'tt1234567');

			expect(html).toContain('action="/api/watch/mac2"');
			expect(html).toContain('name="service" value="ad"');
			expect(html).toContain('name="token" value="ad-key"');
			expect(html).toContain('name="link" value="https://alldebrid.com/f/abc"');
		});

		it('does not offer watch on non-video rows', () => {
			const html = renderTorrentInfo({ ...adInfo }, false, 'ad-key', 'mac2');

			// The DL button still carries the link as name="url"; only the watch
			// button uses name="link", so that is what must be absent.
			expect(html).toContain('name="url" value="https://alldebrid.com/f/def"');
			expect(html).not.toContain('name="link" value="https://alldebrid.com/f/def"');
			expect(html).toContain('name="link" value="https://alldebrid.com/f/abc"');
		});

		it('does not offer watch without a key or player', () => {
			expect(renderTorrentInfo({ ...adInfo }, false, '', 'mac2')).not.toContain(
				'/api/watch/mac2'
			);
			expect(renderTorrentInfo({ ...adInfo }, false, 'ad-key', undefined)).not.toContain(
				'/api/watch/'
			);
		});
	});
});

describe('renderTorrentInfoTB', () => {
	const files = [
		{ id: 4, name: 'Show/Episode.mkv', size: 2048, short_name: 'Episode.mkv' },
		{ id: 5, name: 'Show/readme.txt', size: 12, short_name: 'readme.txt' },
	] as any[];

	it('resolves by hash and file name', () => {
		const html = renderTorrentInfoTB(files, {
			tbKey: 'tb-key',
			app: 'windows/vlc',
			hash: 'hash-tb',
		});

		expect(html).toContain('action="/api/watch/instant/windows/vlc"');
		expect(html).toContain('name="service" value="tb"');
		expect(html).toContain('name="hash" value="hash-tb"');
		expect(html).toContain('name="fileName" value="Show/Episode.mkv"');
		expect(html).not.toContain('value="Show/readme.txt"');
	});

	// A web download is not a torrent — it resolves through TorBox's separate
	// webdl namespace, so it must not be sent to the torrent path.
	it('routes a web download through tbw', () => {
		const html = renderTorrentInfoTB(files, {
			tbKey: 'tb-key',
			app: 'windows/vlc',
			hash: 'wd-hash',
			isWebDownload: true,
		});

		expect(html).toContain('name="service" value="tbw"');
		expect(html).not.toContain('name="service" value="tb"');
	});

	it('offers no watch button without a hash', () => {
		const html = renderTorrentInfoTB(files, { tbKey: 'tb-key', app: 'windows/vlc' });

		expect(html).not.toContain('/api/watch/');
	});

	it('offers no watch button when called without options at all', () => {
		expect(renderTorrentInfoTB(files)).not.toContain('/api/watch/');
	});
});
