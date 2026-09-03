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
	directDownloadPremiumize: vi.fn(),
	addSeedboxTorrent: vi.fn(),
	addOffcloudCloud: vi.fn(),
	getOffcloudCloudStatus: vi.fn(),
	exploreOffcloudCloud: vi.fn(),
	getOffcloudCacheInfo: vi.fn(),
}));

vi.mock('@/services/allDebrid', () => ({ unlockLink: mocks.unlockLink }));
vi.mock('@/services/premiumize', () => ({
	directDownloadPremiumize: mocks.directDownloadPremiumize,
}));
// `isValidBtih` and `joinExploreWithCacheInfo` are pure and are the behaviour
// under test here, so only the four network calls are replaced.
vi.mock('@/services/offcloud', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/offcloud')>();
	return {
		...actual,
		addOffcloudCloud: mocks.addOffcloudCloud,
		getOffcloudCloudStatus: mocks.getOffcloudCloudStatus,
		exploreOffcloudCloud: mocks.exploreOffcloudCloud,
		getOffcloudCacheInfo: mocks.getOffcloudCacheInfo,
	};
});
// `toMagnetUri` and `isDlFinished` are pure and are the behaviour under test
// here - the magnet form and the `>=` threshold are the two things that decide
// what the user gets - so only the one network call is replaced.
vi.mock('@/services/debridLink', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/debridLink')>();
	return { ...actual, addSeedboxTorrent: mocks.addSeedboxTorrent };
});
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
			'intent://cdn.example.com/movie.mkv#Intent;type=video/any;scheme=https;package=com.brouken.player;S.browser_fallback_url=fallback;end'
		);
		expect(buildPlayerIntent('android', 'chooser', url, 'fallback')).toBe(
			'intent://cdn.example.com/movie.mkv#Intent;type=video/any;scheme=https;S.browser_fallback_url=fallback;end'
		);
	});

	// An intent Chrome declines to launch used to go nowhere and leave the tab
	// blank. With a fallback it lands on the stream instead.
	it('gives android somewhere to land when the player will not open', () => {
		expect(
			buildPlayerIntent(
				'android',
				'org.videolan.vlc',
				url,
				'https://real-debrid.com/streaming-1'
			)
		).toContain(
			`S.browser_fallback_url=${encodeURIComponent('https://real-debrid.com/streaming-1')}`
		);
	});

	// `;` ends an intent field, so a raw fallback URL containing one would cut
	// the intent short and take `end` with it.
	it('encodes a fallback URL so it cannot break out of the intent', () => {
		const intent = buildPlayerIntent('android', 'chooser', url, 'https://x.test/a;b?c=1&d=2');

		expect(intent).toContain(
			'S.browser_fallback_url=https%3A%2F%2Fx.test%2Fa%3Bb%3Fc%3D1%26d%3D2'
		);
		expect(intent.endsWith(';end')).toBe(true);
		expect(
			intent.split(';').filter((part) => part.startsWith('S.browser_fallback_url'))
		).toHaveLength(1);
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
		expect(isWatchService('pm')).toBe(true);
		expect(isWatchService('oc')).toBe(true);
		// Debrid-Link is a watch service even though nothing can ever *pick* it
		// from an availability flag - the /api/watch routes gate on this.
		expect(isWatchService('dl')).toBe(true);
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

		// Watch adds and releases around a single play, the way the Real-Debrid
		// path already does.
		expect(mocks.getFileByNameTorBoxStreamUrl).toHaveBeenCalledWith(
			'tb-key',
			'hash',
			'Episode.mkv',
			{ releaseIfAdded: true }
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

		expect(mocks.getBiggestFileTorBoxStreamUrl).toHaveBeenCalledWith('tb-key', 'hash', {
			releaseIfAdded: true,
		});
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

describe('Premiumize intents', () => {
	const files = [
		{
			path: 'BBB/poster.jpg',
			size: 310380,
			link: `https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/pool/uid/100000002/1/tok/sig/poster.jpg`,
			stream_link: null,
		},
		{
			path: 'BBB/Big Buck Bunny.mp4',
			size: 276134947,
			link: `https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/pool/uid/100000002/1/tok/sig/BBB.mp4`,
			stream_link: `https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/pool/uid/100000002/1/tok/sig/BBB-stream.mp4`,
		},
	];

	it('picks the biggest file, never content[0]', async () => {
		// content[0] for a torrent is whatever sorts first - a 310 KB poster in
		// the reference case - so a first-file fallback hands the user a JPEG.
		mocks.directDownloadPremiumize.mockResolvedValue(files);

		const { intent } = await getInstantIntent('pm-key', 'hash', 0, '1.2.3.4', 'web', 'x', 'pm');

		expect(intent).toBe(
			`https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/pool/uid/100000002/1/tok/sig/BBB-stream.mp4`
		);
	});

	it('prefers the named file when the caller knows which one it wants', async () => {
		mocks.directDownloadPremiumize.mockResolvedValue(files);

		const { intent } = await getInstantIntent(
			'pm-key',
			'hash',
			0,
			'1.2.3.4',
			'web',
			'x',
			'pm',
			'poster.jpg'
		);

		expect(intent).toBe(
			`https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/pool/uid/100000002/1/tok/sig/poster.jpg`
		);
	});

	it('reports an empty resolution rather than handing back nothing', async () => {
		mocks.directDownloadPremiumize.mockResolvedValue([]);

		const { error } = await getInstantIntent('pm-key', 'h', 0, '1.2.3.4', 'web', 'x', 'pm');

		expect(error).toMatch(/No Premiumize files/);
	});

	it('surfaces a cache miss as an error, not a crash', async () => {
		mocks.directDownloadPremiumize.mockRejectedValue(new Error('Error downloading this file.'));

		const { error } = await getInstantIntent('pm-key', 'h', 0, '1.2.3.4', 'web', 'x', 'pm');

		expect(error).toMatch(/Error downloading this file/);
	});

	it('treats a Premiumize link as already playable - there is nothing to unrestrict', async () => {
		const { intent } = await getIntent(
			'pm-key',
			`https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/pool/uid/100000002/1/tok/sig/BBB.mp4`,
			'1.2.3.4',
			'web',
			'x',
			'pm'
		);

		expect(intent).toBe(
			`https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/pool/uid/100000002/1/tok/sig/BBB.mp4`
		);
		expect(mocks.unrestrictLink).not.toHaveBeenCalled();
		expect(mocks.unlockLink).not.toHaveBeenCalled();
	});

	it('recognises pm as a watch service', () => {
		expect(isWatchService('pm')).toBe(true);
	});
});
describe('Offcloud intents', () => {
	const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
	const CDN =
		'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/littlemouse-sto/5e8a93bb/100000001/1788380601/tok/sig';
	const LINKS = [`${CDN}/poster.jpg`, `${CDN}/Big%20Buck%20Bunny.mp4`];
	const FILES = [
		{ folder: 'BBB', filename: 'poster.jpg', size: 310380 },
		{ folder: 'BBB', filename: 'Big Buck Bunny.mp4', size: 276134947 },
	];

	const added = (status: string) => ({
		requestId: 'req-1',
		fileName: 'Big Buck Bunny',
		status,
		originalLink: `magnet:?xt=urn:btih:${HASH}`,
	});

	beforeEach(() => {
		mocks.exploreOffcloudCloud.mockResolvedValue(LINKS);
		mocks.getOffcloudCacheInfo.mockResolvedValue([
			{ source: `magnet:?xt=urn:btih:${HASH}`, cached: true, files: FILES },
		]);
	});

	it('plays a cached hash without polling at all', async () => {
		// A cached magnet comes back `downloaded` inside the add response, so the
		// status endpoint is never touched on the path that matters.
		mocks.addOffcloudCloud.mockResolvedValue(added('downloaded'));

		const { intent } = await getInstantIntent('oc-key', HASH, 0, '1.2.3.4', 'web', 'x', 'oc');

		expect(intent).toBe(`${CDN}/Big%20Buck%20Bunny.mp4`);
		expect(mocks.getOffcloudCloudStatus).not.toHaveBeenCalled();
	});

	it('picks the biggest file, never explore[0]', async () => {
		// Explore returns Offcloud's own order, not "biggest first", so a
		// first-link fallback hands the user the 310 KB poster.
		mocks.addOffcloudCloud.mockResolvedValue(added('downloaded'));

		const { intent } = await getInstantIntent('oc-key', HASH, 0, '1.2.3.4', 'web', 'x', 'oc');

		expect(intent).not.toBe(`${CDN}/poster.jpg`);
	});

	it('prefers the named file when the caller knows which one it wants', async () => {
		// The name is matched against the decoded basename of the CDN path, which
		// is the only thing explore's links and cache/info's listing share.
		mocks.addOffcloudCloud.mockResolvedValue(added('downloaded'));

		const { intent } = await getInstantIntent(
			'oc-key',
			HASH,
			0,
			'1.2.3.4',
			'web',
			'x',
			'oc',
			'poster.jpg'
		);

		expect(intent).toBe(`${CDN}/poster.jpg`);
	});

	it('still resolves when cache/info fails - explore alone carries the names', async () => {
		mocks.addOffcloudCloud.mockResolvedValue(added('downloaded'));
		mocks.getOffcloudCacheInfo.mockRejectedValue(new Error('NOAUTH'));

		const { intent } = await getInstantIntent(
			'oc-key',
			HASH,
			0,
			'1.2.3.4',
			'web',
			'x',
			'oc',
			'Big Buck Bunny.mp4'
		);

		expect(intent).toBe(`${CDN}/Big%20Buck%20Bunny.mp4`);
	});

	it('refuses a garbage hash before Offcloud can turn it into a zombie', async () => {
		// `magnet:?xt=urn:btih:zzzz` is accepted upstream with a 200 and a
		// requestId, then parks in `created` forever. Nothing must be added.
		const { error } = await getInstantIntent('oc-key', 'zzzz', 0, '1.2.3.4', 'web', 'x', 'oc');

		expect(error).toMatch(/not a valid info hash/);
		expect(mocks.addOffcloudCloud).not.toHaveBeenCalled();
	});

	it('polls until the item finishes, then resolves it', async () => {
		vi.useFakeTimers();
		try {
			mocks.addOffcloudCloud.mockResolvedValue(added('created'));
			mocks.getOffcloudCloudStatus
				.mockResolvedValueOnce({
					requestId: 'req-1',
					status: 'downloading',
					fileName: 'x',
					progress: 40,
					message: null,
				})
				.mockResolvedValueOnce({
					requestId: 'req-1',
					status: 'downloaded',
					fileName: 'x',
					progress: null,
					message: null,
				});

			const pending = getInstantIntent('oc-key', HASH, 0, '1.2.3.4', 'web', 'x', 'oc');
			await vi.advanceTimersByTimeAsync(5_000);

			expect((await pending).intent).toBe(`${CDN}/Big%20Buck%20Bunny.mp4`);
			expect(mocks.getOffcloudCloudStatus).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives up on a zombie after ~15s instead of polling forever', async () => {
		// A valid hash nobody is seeding behaves exactly like the garbage magnet
		// once it is in: `created` / "Loading..." with nothing upstream ever
		// failing it. Without the deadline this holds the watch tab open for good.
		vi.useFakeTimers();
		try {
			mocks.addOffcloudCloud.mockResolvedValue(added('created'));
			mocks.getOffcloudCloudStatus.mockResolvedValue({
				requestId: 'req-1',
				status: 'created',
				fileName: 'x',
				progress: null,
				message: 'Loading...',
			});

			const pending = getInstantIntent('oc-key', HASH, 0, '1.2.3.4', 'web', 'x', 'oc');
			await vi.advanceTimersByTimeAsync(60_000);
			const { error, intent } = await pending;

			expect(intent).toBeUndefined();
			expect(error).toMatch(/still 'created' after 15s/);
			expect(mocks.exploreOffcloudCloud).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('reports a failed transfer rather than waiting out the deadline', async () => {
		mocks.addOffcloudCloud.mockResolvedValue(added('error'));

		const { error } = await getInstantIntent('oc-key', HASH, 0, '1.2.3.4', 'web', 'x', 'oc');

		expect(error).toMatch(/reported 'error'/);
		expect(mocks.getOffcloudCloudStatus).not.toHaveBeenCalled();
	});

	it('reports an empty resolution rather than handing back nothing', async () => {
		mocks.addOffcloudCloud.mockResolvedValue(added('downloaded'));
		mocks.exploreOffcloudCloud.mockResolvedValue([]);

		const { error } = await getInstantIntent('oc-key', HASH, 0, '1.2.3.4', 'web', 'x', 'oc');

		expect(error).toMatch(/No Offcloud files/);
	});

	it('treats an Offcloud link as already playable - there is nothing to unrestrict', async () => {
		// Same energycdn objects Premiumize serves, measured keyless and any-IP.
		const { intent } = await getIntent(
			'oc-key',
			`${CDN}/Big%20Buck%20Bunny.mp4`,
			'1.2.3.4',
			'web',
			'x',
			'oc'
		);

		expect(intent).toBe(`${CDN}/Big%20Buck%20Bunny.mp4`);
		expect(mocks.unrestrictLink).not.toHaveBeenCalled();
		expect(mocks.unlockLink).not.toHaveBeenCalled();
	});

	it('recognises oc as a watch service', () => {
		expect(isWatchService('oc')).toBe(true);
	});
});

describe('Debrid-Link intents', () => {
	const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
	const HOST = 'https://seed41.debrid.link/dl/s37yg6wsgdilpqo80wwssulm';
	const FILES = [
		{ id: 'f0', name: 'poster.jpg', size: 310_380, downloadUrl: `${HOST}-1/poster.jpg` },
		{
			id: 'f1',
			name: 'Big Buck Bunny.mp4',
			size: 276_134_947,
			downloadUrl: `${HOST}-2/Big+Buck+Bunny.mp4`,
		},
	];

	const torrent = (status: number, over: Record<string, unknown> = {}) => ({
		id: 's37yg6wsgdilpqo80wwssulm',
		name: 'Big Buck Bunny',
		hashString: HASH,
		status,
		downloadPercent: status >= 100 ? 100 : 37,
		totalSize: 276_445_327,
		files: FILES,
		...over,
	});

	it('adds the FULL magnet, never the bare hash', async () => {
		// A bare hash is only accepted when the content is already cached, so
		// sending one here would turn "play this" into a probe that refuses
		// anything Debrid-Link does not already hold.
		mocks.addSeedboxTorrent.mockResolvedValue(torrent(100));

		await getInstantIntent('dl-key', HASH, 0, '1.2.3.4', 'web', 'x', 'dl');

		expect(mocks.addSeedboxTorrent).toHaveBeenCalledWith(
			'dl-key',
			`magnet:?xt=urn:btih:${HASH}`
		);
	});

	it('plays a cached hash straight off the add response', async () => {
		// Cached content answers synchronously complete with live URLs in ~150 ms,
		// so one request goes from hash to playable.
		mocks.addSeedboxTorrent.mockResolvedValue(torrent(100));

		const { intent } = await getInstantIntent('dl-key', HASH, 0, '1.2.3.4', 'web', 'x', 'dl');

		expect(intent).toBe(`${HOST}-2/Big+Buck+Bunny.mp4`);
		expect(mocks.addSeedboxTorrent).toHaveBeenCalledTimes(1);
	});

	it('picks the biggest file, never files[0]', async () => {
		// The list is the torrent's own order, so a first-file fallback hands the
		// user the 310 KB poster.
		mocks.addSeedboxTorrent.mockResolvedValue(torrent(100));

		const { intent } = await getInstantIntent('dl-key', HASH, 0, '1.2.3.4', 'web', 'x', 'dl');

		expect(intent).not.toBe(`${HOST}-1/poster.jpg`);
	});

	it('prefers the named file when the caller knows which one it wants', async () => {
		mocks.addSeedboxTorrent.mockResolvedValue(torrent(100));

		const { intent } = await getInstantIntent(
			'dl-key',
			HASH,
			0,
			'1.2.3.4',
			'web',
			'x',
			'dl',
			'poster.jpg'
		);

		expect(intent).toBe(`${HOST}-1/poster.jpg`);
	});

	it('says it is still downloading rather than polling or hanging', async () => {
		// An unfinished Debrid-Link add is a real BitTorrent download, minutes
		// long at best, so there is nothing worth waiting for in a watch tab.
		mocks.addSeedboxTorrent.mockResolvedValue(torrent(4));

		const { intent, error } = await getInstantIntent(
			'dl-key',
			HASH,
			0,
			'1.2.3.4',
			'web',
			'x',
			'dl'
		);

		expect(intent).toBeUndefined();
		expect(error).toBe(
			'Debrid-Link is still downloading this (37%) — try again once it finishes'
		);
	});

	it('treats a combined status flag as unfinished, never as done', async () => {
		// The vendor's own sample carries `status: 6` (VERIFICATION|DOWNLOADING),
		// which equals no single enum member - hence `>=`, never equality.
		mocks.addSeedboxTorrent.mockResolvedValue(torrent(6));

		const { error } = await getInstantIntent('dl-key', HASH, 0, '1.2.3.4', 'web', 'x', 'dl');

		expect(error).toMatch(/still downloading/);
	});

	it('reports a refusal rather than throwing at the route', async () => {
		mocks.addSeedboxTorrent.mockRejectedValue(new Error('maxTorrent'));

		const { error } = await getInstantIntent('dl-key', HASH, 0, '1.2.3.4', 'web', 'x', 'dl');

		expect(error).toBe('Failed to get Debrid-Link stream: maxTorrent');
	});

	it('serves a known Debrid-Link link directly - there is nothing to redeem', async () => {
		// The torrent id is the whole capability: no token, no signature, no IP
		// binding, and it keeps serving after the torrent is deleted.
		const link = `${HOST}-2/Big+Buck+Bunny.mp4`;

		const { intent } = await getIntent('dl-key', link, '1.2.3.4', 'web', 'x', 'dl');

		expect(intent).toBe(link);
		expect(mocks.unrestrictLink).not.toHaveBeenCalled();
		expect(mocks.unlockLink).not.toHaveBeenCalled();
	});
});
