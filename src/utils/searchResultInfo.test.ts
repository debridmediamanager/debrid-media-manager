import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	showInfoForRD: vi.fn(),
	showInfoForAD: vi.fn(),
	showInfoForTB: vi.fn(),
}));

vi.mock('@/components/showInfo', () => mocks);
vi.mock('@/utils/selectable', () => ({
	isVideo: ({ path }: { path: string }) => /\.(mkv|mp4)$/i.test(path),
}));

import { showInfoForSearchResult } from './searchResultInfo';

const result = (over: Partial<Record<string, any>> = {}) =>
	({
		title: 'Example 2019 1080p',
		hash: 'a'.repeat(40),
		fileSize: 2048,
		rdAvailable: false,
		adAvailable: false,
		tbAvailable: false,
		files: [
			{ fileId: 1, filename: 'Example.mkv', filesize: 2_000_000 },
			{ fileId: 2, filename: 'Example.nfo', filesize: 500 },
		],
		...over,
	}) as any;

const open = (over: Partial<Record<string, any>> = {}, keys: Record<string, any> = {}) =>
	showInfoForSearchResult({
		result: result(over),
		keys,
		player: 'windows/vlc',
		imdbId: 'tt1',
		mediaType: 'movie',
	});

beforeEach(() => vi.clearAllMocks());

describe('showInfoForSearchResult', () => {
	// The modal's Watch rows inherit the service it was opened for, so this has
	// to make the same call the Watch button on the result card makes.
	it('opens the modal of the service that actually has it cached', () => {
		open({ tbAvailable: true }, { rdKey: 'rd', torboxKey: 'tb' });

		expect(mocks.showInfoForTB).toHaveBeenCalledTimes(1);
		expect(mocks.showInfoForRD).not.toHaveBeenCalled();
	});

	it('prefers Real-Debrid when several have it cached', () => {
		open(
			{ rdAvailable: true, adAvailable: true, tbAvailable: true },
			{ rdKey: 'rd', adKey: 'ad', torboxKey: 'tb' }
		);

		expect(mocks.showInfoForRD).toHaveBeenCalledTimes(1);
	});

	it('ignores a cached service the user has no key for', () => {
		open({ tbAvailable: true }, { adKey: 'ad' });

		expect(mocks.showInfoForAD).toHaveBeenCalledTimes(1);
		expect(mocks.showInfoForTB).not.toHaveBeenCalled();
	});

	// Nothing cached is still worth opening: the modal is the file list and the
	// add-to-library surface, not only a watch surface.
	it('falls back to key order when nothing is cached', () => {
		open({}, { rdKey: 'rd', torboxKey: 'tb' });

		expect(mocks.showInfoForRD).toHaveBeenCalledTimes(1);
	});

	it('opens nothing without any key', () => {
		open({ rdAvailable: true }, {});

		expect(mocks.showInfoForRD).not.toHaveBeenCalled();
		expect(mocks.showInfoForAD).not.toHaveBeenCalled();
		expect(mocks.showInfoForTB).not.toHaveBeenCalled();
	});

	// The AllDebrid modal reads `links`; it used to be handed the Real-Debrid
	// shape, so it rendered NaN GB, Invalid Date and an empty file list.
	it('builds AllDebrid its own shape rather than the Real-Debrid one', () => {
		open({ adAvailable: true }, { adKey: 'ad' });

		const info = mocks.showInfoForAD.mock.calls[0][2];
		expect(info.links).toEqual([{ filename: 'Example.mkv', size: 2_000_000, link: '' }]);
		expect(info.size).toBe(2048 * 1024 * 1024);
		expect(Number.isFinite(info.uploadDate)).toBe(true);
		expect(info.fake).toBe(true);
	});

	// Without this the modal's Watch row deletes a magnet the user already owns:
	// the AllDebrid upload dedupes onto the existing one, then cleans it up.
	it('tells the AllDebrid modal when the magnet is already in the library', () => {
		showInfoForSearchResult({
			result: result({ adAvailable: true }),
			keys: { adKey: 'ad' },
			player: 'windows/vlc',
			imdbId: 'tt1',
			mediaType: 'movie',
			adInLibrary: true,
		});

		expect(mocks.showInfoForAD.mock.calls[0][2].adInLibrary).toBe(true);
	});

	it('defaults to cleaning up a magnet the user does not have', () => {
		open({ adAvailable: true }, { adKey: 'ad' });

		expect(mocks.showInfoForAD.mock.calls[0][2].adInLibrary).toBe(false);
	});

	it('keeps non-video files out of every modal', () => {
		open({ rdAvailable: true }, { rdKey: 'rd' });
		expect(mocks.showInfoForRD.mock.calls[0][2].files).toHaveLength(1);

		vi.clearAllMocks();
		open({ tbAvailable: true }, { torboxKey: 'tb' });
		expect(mocks.showInfoForTB.mock.calls[0][2].files).toHaveLength(1);
	});

	it('marks every assembled object fake so library actions stay out', () => {
		open({ rdAvailable: true }, { rdKey: 'rd' });
		expect(mocks.showInfoForRD.mock.calls[0][2].fake).toBe(true);

		vi.clearAllMocks();
		open({ tbAvailable: true }, { torboxKey: 'tb' });
		expect(mocks.showInfoForTB.mock.calls[0][2].fake).toBe(true);
	});
});
