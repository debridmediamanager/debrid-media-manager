import handler from '@/pages/api/torrents/snapshot';
import snapshot from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), check: vi.fn() }));
vi.mock('@/services/repository', () => ({
	repository: {
		upsertAvailability: mocks.publish,
		getHashByLink: vi.fn().mockResolvedValue(null),
		mergeTorrentSnapshot: vi.fn().mockResolvedValue({ kept: 0, borrowed: 0 }),
	},
}));
vi.mock('@/services/realDebrid', () => ({ checkRdLink: mocks.check }));

beforeEach(() => {
	vi.clearAllMocks();
	const file = Object.values(snapshot.SelectedFiles)[0];
	mocks.check.mockResolvedValue({ filename: file.path.split('/').pop(), filesize: file.bytes });
});

it('never publishes unauthenticated snapshot attribution to the stream pool', async () => {
	const res = createMockResponse();
	await handler(
		createMockRequest({
			method: 'POST',
			body: { ...snapshot, IMDBID: 'tt123', Hash: 'a'.repeat(40) },
		}),
		res
	);
	expect(mocks.publish).not.toHaveBeenCalled();
});
