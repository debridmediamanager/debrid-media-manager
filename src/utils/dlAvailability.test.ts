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
	recordDlAvailability: vi.fn(async () => true),
	removeAvailabilityDl: vi.fn(async () => ({ success: true })),
	generateTokenAndHash: vi.fn(async () => ['key', 'solution'] as [string, string]),
});

describe('shareDlAnswer', () => {
	it('offers an add that came back whole, ZIP-listed or not', async () => {
		const d = deps();
		await shareDlAnswer('tt1375666', movie.hashString, movie, false, d);
		const zipped = { ...tv, isZip: true, files: [{ ...tv.files[0], name: `${tv.name}.zip` }] };
		await shareDlAnswer('tt0108778', tv.hashString, zipped, false, d);
		expect(d.recordDlAvailability.mock.calls).toEqual([
			['tt1375666', movie.hashString],
			['tt0108778', tv.hashString],
		]);
	});

	it('reports a release DMM showed as cached when the add starts a download', async () => {
		const d = deps();
		const downloading = { ...movie, status: 4, downloadPercent: 12 };
		await shareDlAnswer('tt1375666', movie.hashString, downloading, true, d);
		expect(d.removeAvailabilityDl).toHaveBeenCalledWith(
			'key',
			'solution',
			movie.hashString,
			expect.any(String)
		);
		expect(d.recordDlAvailability).not.toHaveBeenCalled();

		const quiet = deps();
		await shareDlAnswer('tt1375666', movie.hashString, downloading, false, quiet);
		expect(quiet.removeAvailabilityDl).not.toHaveBeenCalled();
	});
});

describe('recordDlAvailability', () => {
	const fetchMock = vi.fn(async () => new Response('{"success":true}'));
	afterEach(() => {
		fetchMock.mockClear();
		vi.unstubAllGlobals();
	});

	// Check DL hits answered from the user's own library carry no file list, so they were
	// never recorded; DMM now asks Debrid-Link itself, and a page sends only the hash.
	it('sends the hash and title alone, with or without a file list in hand', async () => {
		vi.stubGlobal('fetch', fetchMock);
		expect(await recordDlAvailability('tt0108778', tv.hashString)).toBe(true);
		const sent = JSON.parse(
			(fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		);
		expect(sent).toEqual({
			hash: tv.hashString,
			imdbId: 'tt0108778',
			dmmProblemKey: 'key',
			solution: 'solution',
		});
	});

	it('sends nothing from a page with no IMDb id', async () => {
		vi.stubGlobal('fetch', fetchMock);
		expect(await recordDlAvailability('', movie.hashString)).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
