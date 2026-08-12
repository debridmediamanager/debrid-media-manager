import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	unlockLink: vi.fn(),
	unrestrictLink: vi.fn(),
	addHashAsMagnet: vi.fn(),
	deleteTorrent: vi.fn(),
	getTorrentInfo: vi.fn(),
	handleSelectFilesInRd: vi.fn(),
	getBiggestFileTorBoxStreamUrl: vi.fn(),
	getFileByNameTorBoxStreamUrl: vi.fn(),
	getOwnedTorBoxStreamUrl: vi.fn(),
	getWebDownloadStreamUrlByHash: vi.fn(),
}));

vi.mock('@/services/allDebrid', () => ({ unlockLink: mocks.unlockLink }));
vi.mock('@/services/realDebrid', () => ({
	addHashAsMagnet: mocks.addHashAsMagnet,
	deleteTorrent: mocks.deleteTorrent,
	getTorrentInfo: mocks.getTorrentInfo,
	unrestrictLink: mocks.unrestrictLink,
}));
vi.mock('./addMagnet', () => ({ handleSelectFilesInRd: mocks.handleSelectFilesInRd }));
vi.mock('./getTorBoxStreamUrl', () => ({
	getBiggestFileTorBoxStreamUrl: mocks.getBiggestFileTorBoxStreamUrl,
	getFileByNameTorBoxStreamUrl: mocks.getFileByNameTorBoxStreamUrl,
	getOwnedTorBoxStreamUrl: mocks.getOwnedTorBoxStreamUrl,
	getWebDownloadStreamUrlByHash: mocks.getWebDownloadStreamUrlByHash,
}));

import {
	buildPlayerIntent,
	getInstantIntent,
	getIntent,
	isWatchService,
	pickRdLink,
} from './intent';

beforeEach(() => {
	vi.clearAllMocks();
	// Default: the hash is not in the user's TorBox library, so the cached path
	// is the one under test unless a case says otherwise.
	mocks.getOwnedTorBoxStreamUrl.mockResolvedValue('');
});

describe('buildPlayerIntent', () => {
	const url = 'https://cdn.example.com/movie.mkv';

	it('builds an android intent, naming the package unless the chooser is wanted', () => {
		expect(buildPlayerIntent('android', 'com.brouken.player', url, 'fallback')).toBe(
			'intent://cdn.example.com/movie.mkv#Intent;type=video/any;scheme=https;package=com.brouken.player;end'
		);
		expect(buildPlayerIntent('android', 'chooser', url, 'fallback')).toBe(
			'intent://cdn.example.com/movie.mkv#Intent;type=video/any;scheme=https;end'
		);
	});

	it.each([
		['ios', 'infuse://cdn.example.com/movie.mkv'],
		['mac', 'infuse://cdn.example.com/movie.mkv'],
		['ios2', `infuse://x-callback-url/open?url=${url}`],
		['mac4', `infuse://x-callback-url/open?url=${url}`],
		['mac2', `infuse://weblink?url=${url}`],
		['mac3', `infuse://weblink?url=${url}&new_window=1`],
		['windows', `infuse://${url}`],
	])('maps %s to its scheme', (os, expected) => {
		expect(buildPlayerIntent(os, 'infuse', url, 'fallback')).toBe(expected);
	});

	it('uses the caller-supplied fallback for an unknown os', () => {
		expect(buildPlayerIntent('realdebrid', 'infuse', url, 'https://fallback')).toBe(
			'https://fallback'
		);
	});
});

describe('pickRdLink', () => {
	// A SearchResult's `files` array is shared by all three services and the last
	// availability check to run wins, so a fileId produced by AllDebrid's or
	// TorBox's positional indexing can be handed to an RD watch. Matching on the
	// name is what keeps that from silently playing the wrong file.
	const torrentInfo = {
		files: [
			{ id: 1, path: '/Sample/sample.mkv', selected: 1 },
			{ id: 4, path: '/Feature.2024.1080p.mkv', selected: 1 },
			{ id: 7, path: '/extras.mkv', selected: 0 },
		],
		links: ['https://rd/sample', 'https://rd/feature'],
	};

	it('prefers the file name over the id', () => {
		// fileId 1 is the sample; the name says otherwise and must win.
		expect(pickRdLink(torrentInfo, 1, 'Feature.2024.1080p.mkv')).toBe('https://rd/feature');
	});

	it('matches the name case-insensitively and ignores directories', () => {
		expect(pickRdLink(torrentInfo, 1, 'some/dir/FEATURE.2024.1080P.MKV')).toBe(
			'https://rd/feature'
		);
	});

	it('indexes into selected files only, so an unselected file cannot shift the link', () => {
		expect(pickRdLink(torrentInfo, 4)).toBe('https://rd/feature');
	});

	it('falls back to the id when no name is given', () => {
		expect(pickRdLink(torrentInfo, 1)).toBe('https://rd/sample');
	});

	it('falls back to the first link when neither name nor id matches', () => {
		expect(pickRdLink(torrentInfo, 999, 'not-in-torrent.mkv')).toBe('https://rd/sample');
	});
});

describe('isWatchService', () => {
	it('accepts the three services and nothing else', () => {
		expect(isWatchService('rd')).toBe(true);
		expect(isWatchService('ad')).toBe(true);
		expect(isWatchService('tb')).toBe(true);
		expect(isWatchService('tbw')).toBe(true);
		expect(isWatchService('bogus')).toBe(false);
		expect(isWatchService(undefined)).toBe(false);
	});
});

describe('getInstantIntent', () => {
	it('resolves a Real-Debrid hash by file name and cleans the torrent up', async () => {
		mocks.addHashAsMagnet.mockResolvedValue('rd-1');
		mocks.getTorrentInfo.mockResolvedValue({
			status: 'downloaded',
			files: [
				{ id: 1, path: '/sample.mkv', selected: 1 },
				{ id: 2, path: '/Feature.mkv', selected: 1 },
			],
			links: ['https://rd/sample', 'https://rd/feature'],
		});
		mocks.unrestrictLink.mockResolvedValue({ download: 'https://dl/feature.mkv', id: 'x1' });

		const result = await getInstantIntent(
			'rd-key',
			'hash',
			1,
			'1.2.3.4',
			'windows',
			'vlc',
			'rd',
			'Feature.mkv'
		);

		expect(mocks.unrestrictLink).toHaveBeenCalledWith(
			'rd-key',
			'https://rd/feature',
			'1.2.3.4',
			false
		);
		expect(result.intent).toBe('vlc://https://dl/feature.mkv');
		expect(mocks.deleteTorrent).toHaveBeenCalledWith('rd-key', 'rd-1', false);
	});

	it('deletes the torrent and reports the status when RD has not finished', async () => {
		mocks.addHashAsMagnet.mockResolvedValue('rd-2');
		mocks.getTorrentInfo.mockResolvedValue({ status: 'downloading', files: [], links: [] });

		const result = await getInstantIntent('rd-key', 'hash', 1, '1.2.3.4', 'windows', 'vlc');

		expect(result.error).toContain('downloading');
		expect(mocks.deleteTorrent).toHaveBeenCalledWith('rd-key', 'rd-2', false);
	});

	it('resolves TorBox by file name', async () => {
		mocks.getFileByNameTorBoxStreamUrl.mockResolvedValue([
			'https://tb/stream.mkv',
			1,
			2,
			3,
			'n',
		]);

		const result = await getInstantIntent(
			'tb-key',
			'hash',
			0,
			'1.2.3.4',
			'mac2',
			'omniplayer',
			'tb',
			'dir/Episode.mkv'
		);

		expect(mocks.getFileByNameTorBoxStreamUrl).toHaveBeenCalledWith(
			'tb-key',
			'hash',
			'Episode.mkv'
		);
		expect(result.intent).toBe('omniplayer://weblink?url=https://tb/stream.mkv');
	});

	// The name may have come from a different service's file listing, in which
	// case TorBox will not know it — falling back beats failing the watch.
	it('falls back to the biggest TorBox file when the name does not match', async () => {
		mocks.getFileByNameTorBoxStreamUrl.mockRejectedValue(new Error('not found'));
		mocks.getBiggestFileTorBoxStreamUrl.mockResolvedValue([
			'https://tb/biggest.mkv',
			1,
			2,
			3,
			'n',
		]);

		const result = await getInstantIntent(
			'tb-key',
			'hash',
			0,
			'1.2.3.4',
			'windows',
			'vlc',
			'tb',
			'Wrong.mkv'
		);

		expect(mocks.getBiggestFileTorBoxStreamUrl).toHaveBeenCalledWith('tb-key', 'hash');
		expect(result.intent).toBe('vlc://https://tb/biggest.mkv');
	});

	it('reports TorBox failures instead of throwing', async () => {
		mocks.getBiggestFileTorBoxStreamUrl.mockRejectedValue(new Error('Torrent not cached'));

		const result = await getInstantIntent(
			'tb-key',
			'hash',
			0,
			'1.2.3.4',
			'windows',
			'vlc',
			'tb'
		);

		expect(result.error).toContain('Torrent not cached');
		expect(result.intent).toBeUndefined();
	});

	// A library row can outlive its entry in TorBox's shared cache, and both
	// cached helpers bail out on that before ever looking at the account.
	it('falls back to the user library when TorBox says the hash is not cached', async () => {
		mocks.getBiggestFileTorBoxStreamUrl.mockRejectedValue(
			new Error('Torrent not cached on TorBox')
		);
		mocks.getOwnedTorBoxStreamUrl.mockResolvedValue('https://tb/owned.mkv');

		const result = await getInstantIntent(
			'tb-key',
			'hash',
			0,
			'1.2.3.4',
			'windows',
			'vlc',
			'tb',
			'Episode.mkv'
		);

		expect(mocks.getOwnedTorBoxStreamUrl).toHaveBeenCalledWith('tb-key', 'hash', 'Episode.mkv');
		expect(result.intent).toBe('vlc://https://tb/owned.mkv');
	});

	it('keeps the cached error when the hash is not owned either', async () => {
		mocks.getBiggestFileTorBoxStreamUrl.mockRejectedValue(
			new Error('Torrent not cached on TorBox')
		);
		mocks.getOwnedTorBoxStreamUrl.mockResolvedValue('');

		const result = await getInstantIntent('tb-key', 'h', 0, '1.2.3.4', 'windows', 'vlc', 'tb');

		expect(result.error).toContain('Torrent not cached on TorBox');
	});

	// Web downloads live in TorBox's separate webdl namespace: no cache to
	// consult, and nothing to re-add from a hash.
	it('resolves a TorBox web download through the webdl namespace', async () => {
		mocks.getWebDownloadStreamUrlByHash.mockResolvedValue('https://tb/webdl.mkv');

		const result = await getInstantIntent(
			'tb-key',
			'wd-hash',
			0,
			'1.2.3.4',
			'windows',
			'vlc',
			'tbw',
			'Movie.mkv'
		);

		expect(mocks.getWebDownloadStreamUrlByHash).toHaveBeenCalledWith(
			'tb-key',
			'wd-hash',
			'Movie.mkv'
		);
		expect(mocks.getBiggestFileTorBoxStreamUrl).not.toHaveBeenCalled();
		expect(result.intent).toBe('vlc://https://tb/webdl.mkv');
	});

	it('reports a web download that is not in the account', async () => {
		mocks.getWebDownloadStreamUrlByHash.mockRejectedValue(
			new Error('Web download not found on TorBox')
		);

		const result = await getInstantIntent('tb-key', 'h', 0, '1.2.3.4', 'windows', 'vlc', 'tbw');

		expect(result.error).toContain('Web download not found');
	});

	// AllDebrid refuses magnet/upload from datacenter IPs, so this route cannot
	// serve AD and must say so rather than half-working.
	it('refuses AllDebrid, which has to be prepared in the browser', async () => {
		const result = await getInstantIntent(
			'ad-key',
			'hash',
			0,
			'1.2.3.4',
			'ios',
			'infuse',
			'ad'
		);

		expect(result.error).toContain('browser');
		expect(mocks.addHashAsMagnet).not.toHaveBeenCalled();
	});
});

describe('getIntent', () => {
	it('unlocks an AllDebrid link without touching Real-Debrid', async () => {
		mocks.unlockLink.mockResolvedValue({ link: 'https://rpiqwx.debrid.it/dl/abc/file.mkv' });

		const result = await getIntent(
			'ad-key',
			'https://alldebrid.com/f/abc',
			'1.2.3.4',
			'ios',
			'infuse',
			'ad'
		);

		expect(mocks.unlockLink).toHaveBeenCalledWith('ad-key', 'https://alldebrid.com/f/abc');
		expect(mocks.unrestrictLink).not.toHaveBeenCalled();
		expect(result.intent).toBe('infuse://rpiqwx.debrid.it/dl/abc/file.mkv');
	});

	it('reports an AllDebrid unlock failure', async () => {
		mocks.unlockLink.mockRejectedValue(new Error('LINK_HOST_NOT_SUPPORTED'));

		const result = await getIntent('ad-key', 'link', '1.2.3.4', 'ios', 'infuse', 'ad');

		expect(result.error).toContain('LINK_HOST_NOT_SUPPORTED');
	});

	it('unrestricts through Real-Debrid by default, passing the client IP', async () => {
		mocks.unrestrictLink.mockResolvedValue({ download: 'https://dl/file.mkv', id: 'z9' });

		const result = await getIntent('rd-key', 'https://rd/link', '9.9.9.9', 'windows', 'vlc');

		expect(mocks.unrestrictLink).toHaveBeenCalledWith(
			'rd-key',
			'https://rd/link',
			'9.9.9.9',
			false
		);
		expect(result.intent).toBe('vlc://https://dl/file.mkv');
	});

	it('falls back to the Real-Debrid streaming page on an unknown os', async () => {
		mocks.unrestrictLink.mockResolvedValue({ download: 'https://dl/file.mkv', id: 'z9' });

		const result = await getIntent('rd-key', 'https://rd/link', '9.9.9.9', 'realdebrid', '');

		expect(result.intent).toBe('https://real-debrid.com/streaming-z9');
	});

	it('rejects TorBox, which is resolved by hash rather than by link', async () => {
		const result = await getIntent('tb-key', 'link', '1.2.3.4', 'windows', 'vlc', 'tb');

		expect(result.error).toContain('instant');
	});
});
