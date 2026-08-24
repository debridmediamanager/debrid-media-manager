import handler from '@/pages/api/stremio-tb/cast/series/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTorBoxStreamUrlKeepTorrent } from '@/utils/getTorBoxStreamUrl';
import { generateTorBoxUserId } from '@/utils/torboxCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/getTorBoxStreamUrl');
vi.mock('@/utils/torboxCastApiHelpers');

const mockRepository = vi.mocked(repository);
const mockStreamUrl = vi.mocked(getTorBoxStreamUrlKeepTorrent);

describe('/api/stremio-tb/cast/series/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generateTorBoxUserId).mockResolvedValue('user1');
		mockRepository.saveTorBoxCast = vi.fn().mockResolvedValue(undefined);
	});

	it('saves an episode under its own season:episode key', async () => {
		mockStreamUrl.mockResolvedValue([
			'https://tb/dl',
			1,
			2,
			700,
			42,
			7,
			'Show.S01E02.mkv',
		] as any);

		const req = createMockRequest({
			query: { imdbid: 'tt999', apiKey: 'key', hash: 'hash', fileIds: '7' },
		});
		await handler(req, res);

		expect(mockRepository.saveTorBoxCast).toHaveBeenCalledWith(
			'tt999:1:2',
			'user1',
			'hash',
			'Show.S01E02.mkv',
			'https://tb/dl',
			700,
			42,
			7
		);
		expect((res._getData() as any).errorEpisodes).toEqual([]);
	});

	// The bare imdb id is the *movie* key and TorBoxCast is unique on
	// (imdbId, userId, hash), so an episode written there overwrites whatever
	// this torrent already cast - one file at a time, leaving a single row.
	it('records an error instead of writing an unparsed episode to the bare id', async () => {
		mockStreamUrl.mockResolvedValue([
			'https://tb/dl',
			-1,
			-1,
			700,
			42,
			7,
			'Unnamed.mkv',
		] as any);

		const req = createMockRequest({
			query: { imdbid: 'tt999', apiKey: 'key', hash: 'hash', fileIds: '7' },
		});
		await handler(req, res);

		expect(mockRepository.saveTorBoxCast).not.toHaveBeenCalled();
		const payload = res._getData() as any;
		expect(payload.status).toBe('partial');
		expect(payload.errorEpisodes).toEqual(['File 7 (no episode number in filename)']);
	});
});
