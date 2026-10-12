// @vitest-environment node
import recorded from '@/test/fixtures/library/rd-bdmv-single-selection-2026-10-12.json';
import { convertToUserTorrent, withOriginalRdNames } from '@/utils/fetchTorrents';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Blu-ray rip with only /BDMV/STREAM/00029.m2ts selected showed in the Library
 * as "00029.m2ts" with a "Search again" link, because RD's GET /torrents names
 * a torrent after its one selected file and has no original name. Recorded from
 * the RD test account: the clip row, a "2160p" row whose original is identical,
 * and a descriptive single-file row whose original is a worse name.
 */

const getTorrentInfo = vi.hoisted(() => vi.fn());
vi.mock('@/services/realDebrid', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/realDebrid')>()),
	getTorrentInfo,
}));

const info = recorded.info as Record<string, any>;

describe('RD rows renamed to a bare disc clip', () => {
	beforeEach(() => {
		getTorrentInfo.mockReset();
		getTorrentInfo.mockImplementation(async (_key: string, id: string) => info[id]);
	});

	it('names the library row after the release, not the clip', async () => {
		const rows = (await withOriginalRdNames('key', recorded.list as any)).map(
			convertToUserTorrent
		);
		const [clip, plain, descriptive] = rows;

		expect(clip.title).toBe('The Matrix (1999)');
		expect(clip.filename).toBe(info.RHYN5ZZJ6X6CI.original_filename);
		expect(plain.filename).toBe('2160p');
		expect(descriptive.filename).toBe('Lanterns 2026 S01E08 1080p x265-ELiTE.mkv');
		expect(getTorrentInfo.mock.calls.map(([, id]) => id)).toEqual(['RHYN5ZZJ6X6CI']);
	});

	it('uses the original name from a full /torrents/info response', () => {
		expect(convertToUserTorrent(info.RHYN5ZZJ6X6CI).title).toBe('The Matrix (1999)');
	});

	it('keeps the bare name when /torrents/info fails', async () => {
		getTorrentInfo.mockRejectedValue(new Error('503'));
		const [row] = await withOriginalRdNames('key', [
			{ ...recorded.list[0], id: 'FAILS' } as any,
		]);
		expect(convertToUserTorrent(row).filename).toBe('00029.m2ts');
	});
});
