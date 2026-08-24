import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	deleteMagnetAd: vi.fn(),
	prepareMagnetForCast: vi.fn(),
	pickBiggestVideo: vi.fn(),
	findVideoByName: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock('@/services/allDebrid', () => ({ deleteMagnetAd: mocks.deleteMagnetAd }));
vi.mock('./allDebridCastClientPipeline', () => ({
	prepareMagnetForCast: mocks.prepareMagnetForCast,
	pickBiggestVideo: mocks.pickBiggestVideo,
	findVideoByName: mocks.findVideoByName,
}));
vi.mock('react-hot-toast', () => ({
	default: { error: mocks.toastError },
}));
vi.mock('@/utils/selectable', () => ({
	isVideo: ({ path }: { path: string }) => /\.(mkv|mp4)$/i.test(path),
}));

import {
	buildInstantWatchUrl,
	buildLinkWatchUrl,
	getBiggestVideoFile,
	openWatch,
	pickWatchService,
	watchKeyFor,
} from './watchService';

const cached = (over: Partial<Record<string, boolean>> = {}) => ({
	rdAvailable: false,
	adAvailable: false,
	tbAvailable: false,
	pmAvailable: false,
	...over,
});

beforeEach(() => {
	vi.clearAllMocks();
	// Matches the real signature (Promise<void>); openWatch chains .catch on it.
	mocks.deleteMagnetAd.mockResolvedValue(undefined);
});

describe('pickWatchService', () => {
	it('prefers RD, then AD, then TB', () => {
		const all = cached({ rdAvailable: true, adAvailable: true, tbAvailable: true });
		const keys = { rdKey: 'r', adKey: 'a', torboxKey: 't' };

		expect(pickWatchService(all as any, keys)).toBe('rd');
		expect(
			pickWatchService(cached({ adAvailable: true, tbAvailable: true }) as any, keys)
		).toBe('ad');
		expect(pickWatchService(cached({ tbAvailable: true }) as any, keys)).toBe('tb');
	});

	// Cached somewhere the user has no key for is not watchable.
	it('skips a service whose key is missing', () => {
		const all = cached({ rdAvailable: true, adAvailable: true, tbAvailable: true });

		expect(pickWatchService(all as any, { adKey: 'a' })).toBe('ad');
		expect(pickWatchService(all as any, { torboxKey: 't' })).toBe('tb');
		expect(pickWatchService(all as any, {})).toBeNull();
	});

	it('returns null when nothing is cached', () => {
		expect(
			pickWatchService(cached() as any, { rdKey: 'r', adKey: 'a', torboxKey: 't' })
		).toBeNull();
	});
});

describe('watchKeyFor', () => {
	it('returns the key belonging to the service', () => {
		const keys = { rdKey: 'r', adKey: 'a', torboxKey: 't' };
		expect(watchKeyFor('rd', keys)).toBe('r');
		expect(watchKeyFor('ad', keys)).toBe('a');
		expect(watchKeyFor('tb', keys)).toBe('t');
		expect(watchKeyFor('rd', {})).toBeNull();
	});
});

describe('getBiggestVideoFile', () => {
	it('picks the biggest video, ignoring larger non-video files', () => {
		const result = {
			files: [
				{ fileId: 1, filename: 'huge.iso', filesize: 900 },
				{ fileId: 2, filename: 'small.mkv', filesize: 10 },
				{ fileId: 3, filename: 'feature.mkv', filesize: 500 },
			],
		};

		expect(getBiggestVideoFile(result as any)).toMatchObject({ fileId: 3 });
	});

	it('returns undefined when there are no files', () => {
		expect(getBiggestVideoFile({ files: [] } as any)).toBeUndefined();
	});
});

describe('buildInstantWatchUrl', () => {
	// `player` is itself a two-segment path, so it belongs in the path and must
	// not be percent-encoded the way the query values are.
	it('keeps the player in the path and encodes the query', () => {
		const url = buildInstantWatchUrl({
			service: 'tb',
			player: 'android/com.brouken.player',
			token: 'tok en',
			hash: 'abc',
			fileName: 'A Movie.mkv',
			fileId: 3,
		});

		expect(url.startsWith('/api/watch/instant/android/com.brouken.player?')).toBe(true);
		const params = new URLSearchParams(url.split('?')[1]);
		expect(params.get('service')).toBe('tb');
		expect(params.get('token')).toBe('tok en');
		expect(params.get('fileName')).toBe('A Movie.mkv');
		expect(params.get('fileId')).toBe('3');
	});

	it('omits absent optional params', () => {
		const url = buildInstantWatchUrl({
			service: 'rd',
			player: 'windows/vlc',
			token: 't',
			hash: 'abc',
		});

		expect(url).not.toContain('fileName');
		expect(url).not.toContain('fileId');
	});
});

describe('buildLinkWatchUrl', () => {
	it('encodes the service link', () => {
		const url = buildLinkWatchUrl({
			service: 'ad',
			player: 'ios/infuse',
			token: 'k',
			link: 'https://alldebrid.com/f/a+b',
		});

		const params = new URLSearchParams(url.split('?')[1]);
		expect(url.startsWith('/api/watch/ios/infuse?')).toBe(true);
		expect(params.get('link')).toBe('https://alldebrid.com/f/a+b');
	});
});

describe('openWatch', () => {
	const originalOpen = window.open;
	const originalFetch = global.fetch;
	let fetchMock: ReturnType<typeof vi.fn>;

	const lastRequest = () => {
		const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, any];
		return { url, init, body: JSON.parse(init.body) };
	};

	// A stand-in for the opened tab that records what was written into it, so a
	// test can tell "the tab shows a Play link" from "the tab was navigated".
	const fakeTab = () => {
		const writes: string[] = [];
		return {
			location: { href: '' },
			close: vi.fn(),
			document: {
				open: vi.fn(),
				write: (html: string) => writes.push(html),
				close: vi.fn(),
			},
			shown: () => writes[writes.length - 1] ?? '',
			renders: () => writes.length,
		} as any;
	};

	beforeEach(() => {
		fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ intent: 'vlc://stream' }),
		});
		global.fetch = fetchMock as any;
	});

	afterEach(() => {
		window.open = originalOpen;
		global.fetch = originalFetch;
	});

	it('resolves RD by hash without touching AllDebrid', async () => {
		const tab: any = { location: { href: '' }, close: vi.fn() };
		const open = vi.fn(() => tab);
		window.open = open as any;

		await openWatch({
			service: 'rd',
			player: 'windows/vlc',
			hash: 'abc',
			keys: { rdKey: 'rd-key' },
			fileName: 'Feature.mkv',
		});

		const { url, init, body } = lastRequest();
		expect(url).toBe('/api/watch/resolve/windows/vlc');
		expect(init.method).toBe('POST');
		expect(body).toMatchObject({ service: 'rd', hash: 'abc', fileName: 'Feature.mkv' });
		expect(tab.location.href).toBe('vlc://stream');
		expect(mocks.prepareMagnetForCast).not.toHaveBeenCalled();
	});

	// The key used to travel as a query parameter, which put it in the address
	// bar of the tab that opened and in every access log on the way.
	it('keeps the debrid key out of the request URL', async () => {
		window.open = vi.fn(() => ({ location: { href: '' }, close: vi.fn() })) as any;

		await openWatch({
			service: 'rd',
			player: 'windows/vlc',
			hash: 'abc',
			keys: { rdKey: 'rd-key' },
		});

		const { url, body } = lastRequest();
		expect(url).not.toContain('rd-key');
		expect(body.token).toBe('rd-key');
	});

	// A library row already holds the resolved link. Re-adding the hash would
	// make RD stall on content the account already has.
	it('uses a link the caller already holds instead of the hash', async () => {
		window.open = vi.fn(() => ({ location: { href: '' }, close: vi.fn() })) as any;

		await openWatch({
			service: 'rd',
			player: 'windows/vlc',
			hash: 'abc',
			keys: { rdKey: 'rd-key' },
			link: 'https://real-debrid.com/d/XYZ',
		});

		expect(lastRequest().body.link).toBe('https://real-debrid.com/d/XYZ');
	});

	it('does not re-upload an AD magnet when the row has a link', async () => {
		window.open = vi.fn(() => ({ location: { href: '' }, close: vi.fn() })) as any;

		await openWatch({
			service: 'ad',
			player: 'ios/infuse',
			hash: 'abc',
			keys: { adKey: 'ad-key' },
			link: 'https://alldebrid.com/f/known',
		});

		expect(mocks.prepareMagnetForCast).not.toHaveBeenCalled();
		expect(lastRequest().body.link).toBe('https://alldebrid.com/f/known');
	});

	// The AD magnet prep is async, so the tab has to be opened synchronously on
	// the click and navigated after — opening it post-await is what popup
	// blockers reject.
	it('opens a blank tab first for AD, then navigates it', async () => {
		const tab: any = { location: { href: '' }, close: vi.fn() };
		const open = vi.fn(() => tab);
		window.open = open as any;
		mocks.prepareMagnetForCast.mockResolvedValue({ magnetId: 55, videoFiles: [] });
		mocks.findVideoByName.mockReturnValue({ link: 'https://alldebrid.com/f/xyz' });

		await openWatch({
			service: 'ad',
			player: 'ios/infuse',
			hash: 'abc',
			keys: { adKey: 'ad-key' },
			fileName: 'Feature.mkv',
		});

		expect(open).toHaveBeenCalledWith('', '_blank');
		const { body } = lastRequest();
		expect(body.service).toBe('ad');
		expect(body.link).toBe('https://alldebrid.com/f/xyz');
		expect(tab.location.href).toBe('vlc://stream');
	});

	// The tab used to be closed and the failure reported only by a toast in the
	// opener — which is a background tab by then, so on a phone or a TV box the
	// user watched the tab vanish and was told nothing.
	it('reports a missing intent in the tab, not just in the opener', async () => {
		const tab = fakeTab();
		window.open = vi.fn(() => tab) as any;
		fetchMock.mockResolvedValue({
			ok: false,
			status: 500,
			json: async () => ({ error: "Torrent status is 'queued'" }),
		});

		await openWatch({
			service: 'rd',
			player: 'windows/vlc',
			hash: 'abc',
			keys: { rdKey: 'rd-key' },
		});

		expect(tab.shown()).toContain('queued');
		expect(tab.close).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('queued'));
	});

	// Uploading is AllDebrid's only cache probe, so it leaves the magnet in the
	// account; the unlocked link keeps working after the magnet is removed.
	it('removes the AD magnet it added', async () => {
		const tab: any = { location: { href: '' }, close: vi.fn() };
		window.open = vi.fn(() => tab) as any;
		mocks.prepareMagnetForCast.mockResolvedValue({ magnetId: 55, videoFiles: [] });
		mocks.pickBiggestVideo.mockReturnValue({ link: 'https://alldebrid.com/f/xyz' });

		await openWatch({
			service: 'ad',
			player: 'ios/infuse',
			hash: 'abc',
			keys: { adKey: 'ad-key' },
		});

		expect(mocks.deleteMagnetAd).toHaveBeenCalledWith('ad-key', 55);
	});

	it("leaves the user's own library entry alone", async () => {
		const tab: any = { location: { href: '' }, close: vi.fn() };
		window.open = vi.fn(() => tab) as any;
		mocks.prepareMagnetForCast.mockResolvedValue({ magnetId: 55, videoFiles: [] });
		mocks.pickBiggestVideo.mockReturnValue({ link: 'https://alldebrid.com/f/xyz' });

		await openWatch({
			service: 'ad',
			player: 'ios/infuse',
			hash: 'abc',
			keys: { adKey: 'ad-key' },
			adInLibrary: true,
		});

		expect(mocks.deleteMagnetAd).not.toHaveBeenCalled();
	});

	it('falls back to the biggest video when the name is not in the magnet', async () => {
		const tab: any = { location: { href: '' }, close: vi.fn() };
		window.open = vi.fn(() => tab) as any;
		mocks.prepareMagnetForCast.mockResolvedValue({ magnetId: 1, videoFiles: [] });
		mocks.findVideoByName.mockReturnValue(null);
		mocks.pickBiggestVideo.mockReturnValue({ link: 'https://alldebrid.com/f/biggest' });

		await openWatch({
			service: 'ad',
			player: 'ios/infuse',
			hash: 'abc',
			keys: { adKey: 'ad-key' },
			fileName: 'Not.In.Magnet.mkv',
		});

		expect(lastRequest().body.link).toBe('https://alldebrid.com/f/biggest');
	});

	it('shows the tab why AD prep failed', async () => {
		const tab = fakeTab();
		window.open = vi.fn(() => tab) as any;
		mocks.prepareMagnetForCast.mockRejectedValue(new Error('No video files in magnet'));

		await openWatch({
			service: 'ad',
			player: 'ios/infuse',
			hash: 'abc',
			keys: { adKey: 'ad-key' },
		});

		expect(tab.shown()).toContain('No video files in magnet');
		expect(mocks.toastError).toHaveBeenCalledWith(
			expect.stringContaining('No video files in magnet')
		);
	});

	// The bug this pins: the tab was opened blank and then navigated by assigning
	// `intent://…` to its location. Android Chrome blocks a scripted jump to an
	// app, so the tab stayed on about:blank and no player ever opened. The tap on
	// a real link is what carries the gesture Chrome demands.
	it('hands an android intent to a Play link instead of navigating the tab', async () => {
		const tab = fakeTab();
		window.open = vi.fn(() => tab) as any;
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ intent: 'intent://cdn/movie.mkv#Intent;end' }),
		});

		await openWatch({
			service: 'rd',
			player: 'android/org.videolan.vlc',
			hash: 'abc',
			keys: { rdKey: 'rd-key' },
		});

		expect(tab.location.href).toBe('');
		expect(tab.shown()).toContain('href="intent://cdn/movie.mkv#Intent;end"');
	});

	// Nothing blocks the scripted navigation off Android, so those users keep the
	// zero-press path they have always had — with the link there to press if the
	// player does not come up.
	it('still navigates the tab itself for a non-android player', async () => {
		const tab = fakeTab();
		window.open = vi.fn(() => tab) as any;

		await openWatch({
			service: 'rd',
			player: 'windows/vlc',
			hash: 'abc',
			keys: { rdKey: 'rd-key' },
		});

		expect(tab.location.href).toBe('vlc://stream');
		expect(tab.shown()).toContain('href="vlc://stream"');
	});

	// RD's resolve is five sequential API calls, so the tab is on screen for
	// seconds before an intent exists. It said nothing at all before.
	it('tells the tab it is working before the intent arrives', async () => {
		const tab = fakeTab();
		window.open = vi.fn(() => tab) as any;
		let resolveIntent: (value: any) => void = () => {};
		fetchMock.mockReturnValue(
			new Promise((resolve) => {
				resolveIntent = resolve;
			})
		);

		const watching = openWatch({
			service: 'rd',
			player: 'android/org.videolan.vlc',
			hash: 'abc',
			keys: { rdKey: 'rd-key' },
		});

		expect(tab.shown()).toContain('Real-Debrid');
		expect(tab.shown()).not.toContain('Play');
		resolveIntent({
			ok: true,
			status: 200,
			json: async () => ({ intent: 'intent://x#Intent;end' }),
		});
		await watching;
		expect(tab.shown()).toContain('Play');
	});

	// A closed tab throws on `document`, and a watch that resolved must not be
	// turned into a failure by the tab it can no longer draw into.
	it('survives the user closing the tab mid-resolve', async () => {
		const tab: any = {
			location: { href: '' },
			close: vi.fn(),
			get document(): Document {
				throw new Error('window is closed');
			},
		};
		window.open = vi.fn(() => tab) as any;

		await openWatch({
			service: 'rd',
			player: 'windows/vlc',
			hash: 'abc',
			keys: { rdKey: 'rd-key' },
		});

		expect(mocks.toastError).not.toHaveBeenCalled();
	});

	it('reports a missing key instead of opening anything', async () => {
		const open = vi.fn();
		window.open = open as any;

		await openWatch({ service: 'tb', player: 'windows/vlc', hash: 'abc', keys: {} });

		expect(open).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('TorBox'));
	});
});

describe('Premiumize in the watch order', () => {
	it('serves a stream when Premiumize is the only service that has it', () => {
		expect(pickWatchService(cached({ pmAvailable: true }), { premiumizeKey: 'pm' })).toBe('pm');
	});

	it('never takes playback away from a service the user already had', () => {
		const keys = { rdKey: 'rd', adKey: 'ad', torboxKey: 'tb', premiumizeKey: 'pm' };
		expect(pickWatchService(cached({ rdAvailable: true, pmAvailable: true }), keys)).toBe('rd');
		expect(pickWatchService(cached({ adAvailable: true, pmAvailable: true }), keys)).toBe('ad');
		expect(pickWatchService(cached({ tbAvailable: true, pmAvailable: true }), keys)).toBe('tb');
	});

	it('ignores a cached Premiumize result when the user has no Premiumize key', () => {
		expect(pickWatchService(cached({ pmAvailable: true }), { rdKey: 'rd' })).toBeNull();
	});

	it('hands the Premiumize key to the pm service', () => {
		expect(watchKeyFor('pm', { rdKey: 'rd', premiumizeKey: 'pm' })).toBe('pm');
		expect(watchKeyFor('pm', { rdKey: 'rd' })).toBeNull();
	});
});
