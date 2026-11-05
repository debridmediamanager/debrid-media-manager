import type { DebridLinkTorrent } from '@/services/debridLink';
import dlMovie from '@/test/fixtures/libraryAvailability/dl_movie.json';
import dlTv from '@/test/fixtures/libraryAvailability/dl_tv.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordDlAvailability } from './availability';
import { shareDlAnswer } from './dlAvailability';

vi.mock('./token', () => ({ generateTokenAndHash: async () => ['key', 'solution'] }));

// real seedbox rows from the Debrid-Link main account (2026-11-05), download URLs redacted
const movie = dlMovie as DebridLinkTorrent;
const tv = dlTv as DebridLinkTorrent;

const deps = () => ({
	getSeedboxTorrent: vi.fn(async () => tv),
	recordDlAvailability: vi.fn(async () => true),
	removeAvailabilityDl: vi.fn(async () => ({ success: true })),
	generateTokenAndHash: vi.fn(async () => ['key', 'solution'] as [string, string]),
});

describe('shareDlAnswer', () => {
	it('records an add that came back whole', async () => {
		const d = deps();
		await shareDlAnswer('dlkey', 'tt1375666', movie.hashString, movie, false, d);
		expect(d.recordDlAvailability).toHaveBeenCalledWith(
			'tt1375666',
			movie.hashString,
			movie.name,
			movie.files
		);
		expect(d.getSeedboxTorrent).not.toHaveBeenCalled();
	});

	it('fetches a ZIP-listed torrent on its own for its files', async () => {
		const d = deps();
		const zipped = { ...tv, isZip: true, files: [{ ...tv.files[0], name: `${tv.name}.zip` }] };
		await shareDlAnswer('dlkey', 'tt0108778', tv.hashString, zipped, false, d);
		expect(d.getSeedboxTorrent).toHaveBeenCalledWith('dlkey', tv.id);
		expect(d.recordDlAvailability).toHaveBeenCalledWith(
			'tt0108778',
			tv.hashString,
			tv.name,
			tv.files
		);
	});

	it('forgets a release DMM showed as cached when the add starts a download', async () => {
		const d = deps();
		const downloading = { ...movie, status: 4, downloadPercent: 12 };
		await shareDlAnswer('dlkey', 'tt1375666', movie.hashString, downloading, true, d);
		expect(d.removeAvailabilityDl).toHaveBeenCalledWith(
			'key',
			'solution',
			movie.hashString,
			expect.any(String)
		);
		expect(d.recordDlAvailability).not.toHaveBeenCalled();

		const quiet = deps();
		await shareDlAnswer('dlkey', 'tt1375666', movie.hashString, downloading, false, quiet);
		expect(quiet.removeAvailabilityDl).not.toHaveBeenCalled();
	});
});

describe('recordDlAvailability', () => {
	const fetchMock = vi.fn(async () => new Response('{"success":true}'));
	afterEach(() => {
		fetchMock.mockClear();
		vi.unstubAllGlobals();
	});

	it('sends names and sizes, never a download URL', async () => {
		vi.stubGlobal('fetch', fetchMock);
		expect(await recordDlAvailability('tt0108778', tv.hashString, tv.name, tv.files)).toBe(
			true
		);
		const sent = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
			.body as string;
		expect(sent).not.toContain('downloadUrl');
		expect(sent).not.toContain('debrid.link');
		expect(JSON.parse(sent).files).toHaveLength(24);
	});

	it('sends nothing for a partial file, a non-video release or a page with no IMDb id', async () => {
		vi.stubGlobal('fetch', fetchMock);
		const partial = movie.files.map((f) => ({ ...f, downloadPercent: 97 }));
		const audio = movie.files.map((f) => ({ ...f, name: 'Album/01 Track.flac' }));
		expect(await recordDlAvailability('tt1375666', movie.hashString, movie.name, partial)).toBe(
			false
		);
		expect(await recordDlAvailability('tt1375666', movie.hashString, movie.name, audio)).toBe(
			false
		);
		expect(await recordDlAvailability('', movie.hashString, movie.name, movie.files)).toBe(
			false
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
