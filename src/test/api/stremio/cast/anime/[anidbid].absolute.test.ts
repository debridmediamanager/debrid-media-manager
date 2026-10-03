import handler from '@/pages/api/stremio/cast/anime/[anidbid]';
import fixture from '@/test/fixtures/anime/anime-episode-releases.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real releases from production's `anime:*` rows, each a single-file torrent,
// so its name is the filename Real-Debrid's unrestrict answer carries. Only the
// Real-Debrid calls are mocked: getStreamUrl and its filename parse are real.

const { mockSaveCast, mockUnrestrict } = vi.hoisted(() => ({
	mockSaveCast: vi.fn(),
	mockUnrestrict: vi.fn(),
}));

vi.mock('@/services/repository', () => ({ repository: { saveCast: mockSaveCast } }));

vi.mock('@/utils/castApiHelpers', async () => {
	const actual =
		await vi.importActual<typeof import('@/utils/castApiHelpers')>('@/utils/castApiHelpers');
	return { ...actual, generateUserId: vi.fn().mockResolvedValue('user-1') };
});

vi.mock('@/utils/addMagnet', () => ({ handleSelectFilesInRd: vi.fn() }));

vi.mock('@/services/realDebrid', () => ({
	addHashAsMagnet: vi.fn().mockResolvedValue('RDTORRENT'),
	getTorrentInfo: vi.fn().mockResolvedValue({
		files: [{ id: 1, bytes: 1_498_000_000, selected: 1 }],
		links: ['https://real-debrid.com/d/ABCDEFGHIJKLM'],
	}),
	unrestrictLink: mockUnrestrict,
	deleteTorrent: vi.fn(),
}));

const release = (filename: string) => fixture.releases.find((r) => r.filename === filename)!;

async function cast(anidbid: string, filename: string) {
	const { hash, size_bytes } = release(filename);
	mockUnrestrict.mockResolvedValue({
		download: 'https://download.real-debrid.com/d/STREAM/file.mkv',
		link: 'https://real-debrid.com/d/ABCDEFGHIJKLM',
		filename,
		filesize: Math.round(size_bytes * 1024 * 1024),
		streamable: 1,
	});
	const res = createMockResponse();
	await handler(
		createMockRequest({
			query: { anidbid, hash, fileIds: '1' },
			headers: { authorization: 'Bearer tok', 'x-real-ip': '203.0.113.7' },
		}),
		res
	);
	return res;
}

describe('/api/stremio/cast/anime/[anidbid] with absolute episode numbers', () => {
	beforeEach(() => vi.clearAllMocks());

	// AniDB gives every season its own entry and numbers that entry's episodes
	// from 1 with no seasons at all, so an absolute number is season 1 of the
	// entry the cast is keyed by.
	it.each([
		['anidb-17617', '[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv', 5],
		['anidb-69', 'One Piece - 1100 - 1080p WEB x264 -NanDesuKa (CR).mkv', 1100],
		[
			'anidb-69',
			'[Valenciano] One Piece - 1100 [1080p][AV1 10bit][AAC][Multi-Sub] (Weekly).mkv',
			1100,
		],
		[
			'anidb-18117',
			'[Erai-raws] Your Forma - 03 [1080p AMZN WEB-DL AVC EAC3][MultiSub][440194DA].mkv',
			3,
		],
	])('casts %s %s as season 1', async (anidbid, filename, episode) => {
		const res = await cast(anidbid, filename);

		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: [] });
		expect(mockSaveCast).toHaveBeenCalledWith(
			`${anidbid}:1:${episode}`,
			'user-1',
			release(filename).hash,
			'https://download.real-debrid.com/d/STREAM/file.mkv',
			'https://real-debrid.com/d/ABCDEFGHIJKLM',
			Math.round(release(filename).size_bytes)
		);
	});

	it.each([
		['anidb-17617', '[Judas] Sousou no Frieren - S01E03.mkv', '1:3'],
		[
			'anidb-18117',
			'Your.Forma.S01E03.Pursuit.REPACK.1080p.AMZN.WEB-DL.AAC2.0.H.264-VARYG.mkv',
			'1:3',
		],
	])('keeps the season a release names: %s %s', async (anidbid, filename, key) => {
		await cast(anidbid, filename);

		expect(mockSaveCast).toHaveBeenCalledWith(
			`${anidbid}:${key}`,
			'user-1',
			expect.any(String),
			expect.any(String),
			expect.any(String),
			expect.any(Number)
		);
	});
});
