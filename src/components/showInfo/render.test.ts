import { describe, expect, it } from 'vitest';

import {
	renderTorrentInfo,
	renderTorrentInfoDL,
	renderTorrentInfoOC,
	renderTorrentInfoTB,
} from './render';

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
	// The watch button is bound to openWatch after the modal opens, so its per-row
	// details ride on data attributes rather than a form. The debrid key is not
	// among them - it never reaches the markup at all now.
	it('carries the resolved link on a real torrent row', () => {
		const html = renderTorrentInfo(
			{ ...rdInfo },
			true,
			'rd-token',
			'mac2',
			'tt1234567',
			'movie'
		);

		expect(html).toContain('data-watch="1"');
		expect(html).toContain('data-watch-link="https://real-debrid.com/link"');
		expect(html).toContain('data-watch-file-id="1"');
		// The watch form - and the key it carried in its query string - is gone.
		expect(html).not.toContain('action="/api/watch');
		expect(html).toContain('action="/api/stremio/cast/tt1234567"');
		expect(html).toContain('name="mediaType" value="movie"');
	});

	it('carries only the hash details on a fake torrent row', () => {
		const fakeInfo = {
			...rdInfo,
			fake: true,
			links: [],
		};
		const html = renderTorrentInfo(fakeInfo, true, 'rd-token', 'mac2', 'tt1234567', 'movie');

		expect(html).toContain('data-watch="1"');
		// No link exists yet, so the row has to resolve from the hash instead.
		expect(html).not.toContain('data-watch-link');
		expect(html).toContain('data-watch-file-id="1"');
		// A fake info object is built from search results, whose file ids may
		// belong to another service's listing, so the name has to travel too.
		expect(html).toContain('data-watch-file-name="Example.mkv"');
	});

	// AllDebrid and TorBox rows always gated on this; Real-Debrid did not, so it
	// offered "Watch" on subtitles and .nfo files.
	it('does not offer watch on a non-video Real-Debrid row', () => {
		const html = renderTorrentInfo(
			{ ...rdInfo, files: [{ ...baseFile, path: 'Example.nfo' }] },
			true,
			'rd-token',
			'mac2'
		);

		expect(html).not.toContain('data-watch');
	});

	it('does not offer watch without a key', () => {
		const html = renderTorrentInfo({ ...rdInfo }, true, '', 'mac2');

		expect(html).not.toContain('data-watch');
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

			expect(html).toContain('data-watch="1"');
			expect(html).toContain('data-watch-link="https://alldebrid.com/f/abc"');
			expect(html).not.toContain('ad-key');
		});

		it('does not offer watch on non-video rows', () => {
			const html = renderTorrentInfo({ ...adInfo }, false, 'ad-key', 'mac2');

			// The DL button still carries the link as name="url"; only the watch
			// button uses data-watch-link, so that is what must be absent.
			expect(html).toContain('name="url" value="https://alldebrid.com/f/def"');
			expect(html).not.toContain('data-watch-link="https://alldebrid.com/f/def"');
			expect(html).toContain('data-watch-link="https://alldebrid.com/f/abc"');
		});

		// A magnet built from a search result has no AllDebrid link yet - the
		// upload that produces one happens in the browser, on the click.
		it('watches by file name when the row has no link', () => {
			const fakeAd = {
				links: [{ filename: 'Example.mkv', link: '', size: 2048 }],
			};
			const html = renderTorrentInfo(fakeAd, false, 'ad-key', 'mac2');

			expect(html).toContain('data-watch="1"');
			expect(html).not.toContain('data-watch-link');
			expect(html).toContain('data-watch-file-name="Example.mkv"');
			// Nothing to download yet either.
			expect(html).not.toContain('alldebrid.com/service/');
		});

		it('does not offer watch without a key or player', () => {
			expect(renderTorrentInfo({ ...adInfo }, false, '', 'mac2')).not.toContain('data-watch');
			expect(renderTorrentInfo({ ...adInfo }, false, 'ad-key', undefined)).not.toContain(
				'data-watch'
			);
		});
	});
});

describe('renderTorrentInfoTB', () => {
	const files = [
		{ id: 4, name: 'Show/Episode.mkv', size: 2048, short_name: 'Episode.mkv' },
		{ id: 5, name: 'Show/readme.txt', size: 12, short_name: 'readme.txt' },
	] as any[];

	it('resolves by file name', () => {
		const html = renderTorrentInfoTB(files, {
			tbKey: 'tb-key',
			app: 'windows/vlc',
			hash: 'hash-tb',
		});

		expect(html).toContain('data-watch="1"');
		expect(html).toContain('data-watch-file-name="Show/Episode.mkv"');
		expect(html).not.toContain('data-watch-file-name="Show/readme.txt"');
		expect(html).not.toContain('tb-key');
	});

	it('offers no watch button without a hash', () => {
		const html = renderTorrentInfoTB(files, { tbKey: 'tb-key', app: 'windows/vlc' });

		expect(html).not.toContain('data-watch');
	});

	it('offers no watch button when called without options at all', () => {
		expect(renderTorrentInfoTB(files)).not.toContain('data-watch');
	});
});

describe('renderTorrentInfoOC', () => {
	const CDN = 'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/n-sto/obj/1/2/tok/sig';
	const files = [
		{ link: `${CDN}/Episode.mkv`, filename: 'Episode.mkv', filesize: 2048 },
		{ link: `${CDN}/readme.txt`, filename: 'readme.txt', filesize: 12 },
	];

	// An Offcloud CDN link is already playable - keyless, any IP, Range honoured
	// - so both buttons work off the link and neither needs the info hash a
	// plain-HTTP row does not have.
	it('carries the explore link on the watch row', () => {
		const html = renderTorrentInfoOC(files, { canWatch: true });

		expect(html).toContain('data-watch="1"');
		expect(html).toContain(`data-watch-link="${CDN}/Episode.mkv"`);
		expect(html).toContain(`data-oc-link="${CDN}/Episode.mkv"`);
	});

	it('does not offer watch on a non-video row', () => {
		const html = renderTorrentInfoOC(files, { canWatch: true });

		expect(html).not.toContain(`data-watch-link="${CDN}/readme.txt"`);
		// Downloading it is still fine.
		expect(html).toContain(`data-oc-link="${CDN}/readme.txt"`);
	});

	it('offers no watch button without a player', () => {
		expect(renderTorrentInfoOC(files)).not.toContain('data-watch');
	});

	// `cloud/explore` returns bare URLs; a file `cache/info` did not describe
	// still has to appear, with its decoded basename.
	it('renders a file whose size is unknown', () => {
		const html = renderTorrentInfoOC([
			{ link: `${CDN}/Episode.mkv`, filename: 'Episode.mkv', filesize: null },
		]);

		expect(html).toContain('Episode.mkv');
		expect(html).toContain('0.00');
	});
});

describe('renderTorrentInfoDL', () => {
	const SEED = 'https://seed41.debrid.link/dl/s37yg6wsgdilpqo80wwssulm';
	const files = [
		{ downloadUrl: `${SEED}-2/Episode.mkv`, filename: 'Episode.mkv', filesize: 2048 },
		{ downloadUrl: `${SEED}-3/readme.txt`, filename: 'readme.txt', filesize: 12 },
	];

	// A Debrid-Link download URL is the entire capability - no token, no
	// signature, no IP binding - so both buttons work off it directly and
	// neither resolves a hash.
	it('carries the keyless download URL on the watch row', () => {
		const html = renderTorrentInfoDL(files, { canWatch: true });

		expect(html).toContain('data-watch="1"');
		expect(html).toContain(`data-watch-link="${SEED}-2/Episode.mkv"`);
		expect(html).toContain(`data-dl-link="${SEED}-2/Episode.mkv"`);
	});

	it('does not offer watch on a non-video row', () => {
		const html = renderTorrentInfoDL(files, { canWatch: true });

		expect(html).not.toContain(`data-watch-link="${SEED}-3/readme.txt"`);
		// Downloading it is still fine.
		expect(html).toContain(`data-dl-link="${SEED}-3/readme.txt"`);
	});

	it('offers no watch button without a player', () => {
		expect(renderTorrentInfoDL(files)).not.toContain('data-watch');
	});

	// A ZIP placeholder row has no URL to hand out; it is still listed, because
	// blanking the file table would hide the release entirely.
	it('lists a file with no URL but offers no buttons for it', () => {
		const html = renderTorrentInfoDL(
			[{ downloadUrl: '', filename: 'Some.Show.S02.zip', filesize: 4096 }],
			{ canWatch: true }
		);

		expect(html).toContain('Some.Show.S02.zip');
		expect(html).not.toContain('data-dl-link');
		expect(html).not.toContain('data-watch');
	});
});
