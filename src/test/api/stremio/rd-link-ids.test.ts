// @vitest-environment node
import play from '@/pages/api/stremio/[userid]/play/[link]';
import watch from '@/pages/api/stremio/[userid]/watch/[imdbid]/[pingpong]';
import castLibrary from '@/pages/api/stremio/cast/library/[torrentIdPlusHash]';
import { getTorrentInfo, unrestrictLink } from '@/services/realDebrid';
import { repository } from '@/services/repository';
import type { TorrentInfoResponse, UnrestrictResponse } from '@/services/types';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/realDebrid', () => ({ getTorrentInfo: vi.fn(), unrestrictLink: vi.fn() }));
vi.mock('@/services/repository', () => ({
	repository: {
		getCastProfile: vi.fn(),
		getLatestCast: vi.fn(),
		getIMDBIdByHash: vi.fn(),
		saveCast: vi.fn(),
	},
}));
vi.mock('@/utils/castRdToken', () => ({
	castAccessToken: vi.fn(async () => 'test-access'),
	forgetCastAccessToken: vi.fn(),
}));
vi.mock('@/utils/castApiHelpers', () => ({ generateUserId: vi.fn(async () => 'viewer') }));
vi.mock('@/services/takedown/blocklist', () => ({
	getBlocklist: vi.fn(async () => ({ hashes: new Set() })),
	isHashBlockedIn: vi.fn(),
	setBlocklistForTests: vi.fn(),
}));

const id = 'FIXTURELINK00ABCDEFGHIJKLM';
const key = 'FIXTURELINK00';
const link = `https://real-debrid.com/d/${id}`;
const db = vi.mocked(repository);

describe('historical RD link consumers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_ORIGIN = 'https://origin.example';
	});

	it('redeems a historical 26-character play id using the content key and viewer IP', async () => {
		db.getCastProfile.mockResolvedValue({
			clientId: null,
			clientSecret: null,
			refreshToken: null,
			apiKey: 'test-token',
			movieMaxSize: 0,
			episodeMaxSize: 0,
		});
		// Only the download field is consumed by this route.
		vi.mocked(unrestrictLink).mockResolvedValue({
			download: 'https://download.example/video',
		} as UnrestrictResponse);
		const res = createMockResponse();
		await play(
			createMockRequest({
				query: { userid: 'viewer', link: id },
				headers: { 'x-forwarded-for': '203.0.113.20' },
			}),
			res
		);
		expect(unrestrictLink).toHaveBeenCalledWith(
			'test-access',
			`https://real-debrid.com/d/${key}`,
			'203.0.113.20',
			true
		);
		expect(res.redirect).toHaveBeenCalledWith('https://download.example/video');
	});

	it('normalizes a historical watch link before redirecting to play', async () => {
		db.getLatestCast.mockResolvedValue({ link, url: '' });
		const res = createMockResponse();
		await watch(
			createMockRequest({
				query: { userid: 'viewer', imdbid: 'tt1234567', pingpong: 'ping' },
			}),
			res
		);
		expect(res.redirect).toHaveBeenCalledWith(
			302,
			`https://origin.example/api/stremio/viewer/play/${key}`
		);
	});

	it('does not turn a non-RD stored link into an RD play id', async () => {
		db.getLatestCast.mockResolvedValue({
			link: 'https://other.example/d/FIXTURELINK00ABCDEFGHIJKLM',
			url: '',
		});
		const res = createMockResponse();
		await watch(
			createMockRequest({
				query: { userid: 'viewer', imdbid: 'tt1234567', pingpong: 'ping', hop: '20' },
			}),
			res
		);
		expect(res.redirect).not.toHaveBeenCalled();
		expect(res._getStatusCode()).toBe(404);
	});

	it('stores the shared content-key link when casting a historical library link', async () => {
		db.getIMDBIdByHash.mockResolvedValue('tt1234567');
		vi.mocked(getTorrentInfo).mockResolvedValue({
			hash: '0123456789012345678901234567890123456789',
			files: [{ id: 1, selected: 1, path: '/Movie.mkv', bytes: 1024 }],
			links: [link],
		} as TorrentInfoResponse);
		const res = createMockResponse();
		await castLibrary(
			createMockRequest({
				headers: { authorization: 'Bearer test-token' },
				query: {
					torrentIdPlusHash: 'TORRENT000000:0123456789012345678901234567890123456789',
				},
			}),
			res
		);
		expect(res._getStatusCode()).toBe(200);
		expect(db.saveCast).toHaveBeenCalledWith(
			'tt1234567',
			'viewer',
			expect.any(String),
			'/Movie.mkv',
			`https://real-debrid.com/d/${key}`,
			1
		);
	});
});
