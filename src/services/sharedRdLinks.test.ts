import checkAnswer from '@/test/fixtures/realdebrid/unrestrict-check-13-char-code-2026-10-27.json';
import unknownCodeAnswer from '@/test/fixtures/realdebrid/unrestrict-check-unknown-code-2026-10-27.json';
import zurgDirectSnapshot from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0.json';
import { TorrentSnapshot } from '@/utils/torrentSnapshot';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRdLink } from './realDebrid';
import { repository } from './repository';
import { fileSharedRdLinks } from './sharedRdLinks';

vi.mock('./repository');
vi.mock('./realDebrid', async (importOriginal) => ({
	...(await importOriginal<typeof import('./realDebrid')>()),
	checkRdLink: vi.fn(),
}));
const mockRepository = vi.mocked(repository);
const mockCheck = vi.mocked(checkRdLink);

// zurg posts each Real-Debrid file's code cut to 13 characters in `Link`, the
// shape this real zurg 0.11.0 post already carries (its code is replaced).
const FILE = '/Giannis.The.Marvelous.Journey.2024.2160p.4K.WEB.x265.10bit.AAC5.1-[YTS.MX].mkv';
const BYTES = 5209028737;

function snapshot(change: (body: Record<string, any>) => void = () => {}) {
	const body = structuredClone(zurgDirectSnapshot) as Record<string, any>;
	change(body);
	return TorrentSnapshot.parse(body);
}

describe('fileSharedRdLinks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepository.getHashByLink = vi.fn().mockResolvedValue(null);
		mockRepository.upsertAvailability = vi.fn().mockResolvedValue(undefined);
		mockCheck.mockResolvedValue({ filename: FILE.slice(1), filesize: BYTES });
	});

	it('files a release whose code Real-Debrid names as the same file', async () => {
		expect(await fileSharedRdLinks(snapshot())).toBe(1);

		expect(mockCheck).toHaveBeenCalledWith('https://real-debrid.com/d/REDACTEDLINK0');
		expect(mockRepository.upsertAvailability).toHaveBeenCalledWith(
			expect.objectContaining({
				hash: 'edb8358a66fa1a70244bcf645ec6b7622fe7ceb5',
				imdbId: 'tt30895834',
				host: 'real-debrid.com',
				status: 'downloaded',
				progress: 100,
				selectedFiles: [{ id: 1, path: FILE, bytes: BYTES, selected: 1 }],
				links: ['https://real-debrid.com/d/REDACTEDLINK0'],
			})
		);
	});

	it("cuts an older zurg's full 16-character link to the shareable code", async () => {
		await fileSharedRdLinks(
			snapshot((body) => {
				Object.values<any>(body.SelectedFiles)[0].Link =
					'https://real-debrid.com/d/REDACTEDLINK0ABC';
			})
		);
		expect(mockCheck).toHaveBeenCalledWith('https://real-debrid.com/d/REDACTEDLINK0');
	});

	it.each([
		['a code Real-Debrid knows no file for', null],
		['a code for another file', { filename: 'Something.Else.2024.mkv', filesize: BYTES }],
		['a code for a file of another size', { filename: FILE.slice(1), filesize: BYTES - 1 }],
	])('files nothing for %s', async (_, answer) => {
		mockCheck.mockResolvedValue(answer);
		expect(await fileSharedRdLinks(snapshot())).toBe(0);
		expect(mockRepository.upsertAvailability).not.toHaveBeenCalled();
	});

	it('asks Real-Debrid nothing about codes already filed under the release', async () => {
		mockRepository.getHashByLink = vi
			.fn()
			.mockResolvedValue('edb8358a66fa1a70244bcf645ec6b7622fe7ceb5');
		expect(await fileSharedRdLinks(snapshot())).toBe(0);
		expect(mockCheck).not.toHaveBeenCalled();
	});

	it.each([
		['no IMDb id', (body: Record<string, any>) => (body.IMDBID = '')],
		[
			'an id that is not an IMDb id',
			(body: Record<string, any>) => (body.IMDBID = 'opensubtitles:n/a'),
		],
		[
			'a link of another service',
			(body: Record<string, any>) =>
				(Object.values<any>(body.SelectedFiles)[0].Link =
					'https://alldebrid.com/f/AbCdEfGhIj'),
		],
		[
			'no link, as zurg posted from 2026-10-20',
			(body: Record<string, any>) => delete Object.values<any>(body.SelectedFiles)[0].Link,
		],
	])('asks nothing for a release with %s', async (_, change) => {
		expect(await fileSharedRdLinks(snapshot(change))).toBe(0);
		expect(mockCheck).not.toHaveBeenCalled();
	});
});

describe('checkRdLink', () => {
	it('reads the name and size Real-Debrid answered for a 13-character code', async () => {
		const { checkRdLink: realCheck } =
			await vi.importActual<typeof import('./realDebrid')>('./realDebrid');
		const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: checkAnswer });
		expect(await realCheck('https://real-debrid.com/d/REDACTEDLINK0')).toEqual({
			filename: '[Judas] Alps No Shoujo Heidi - 01.mkv',
			filesize: 186573615,
		});
		expect(post.mock.calls[0][0]).toBe('https://api.real-debrid.com/rest/1.0/unrestrict/check');
		expect(post.mock.calls[0][1]).toBe(
			'link=https%3A%2F%2Freal-debrid.com%2Fd%2FREDACTEDLINK0'
		);
		expect(post.mock.calls[0][2]?.headers).not.toHaveProperty('Authorization');
		post.mockRestore();
	});

	it('answers null for a code Real-Debrid knows no file for', async () => {
		const { checkRdLink: realCheck } =
			await vi.importActual<typeof import('./realDebrid')>('./realDebrid');
		const error = Object.assign(new Error('Request failed with status code 404'), {
			isAxiosError: true,
			response: { status: 404, data: unknownCodeAnswer },
		});
		const post = vi.spyOn(axios, 'post').mockRejectedValue(error);
		expect(await realCheck('https://real-debrid.com/d/QQQQQQQQQQQQQ')).toBeNull();
		post.mockRestore();
	});
});
