import { beforeEach, describe, expect, it, vi } from 'vitest';

import refused from '../test/fixtures/alldebrid-restart-refused.json';

const mocks = vi.hoisted(() => ({ post: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock('axios', () => ({
	default: {
		create: vi.fn(() => ({
			post: mocks.post,
			interceptors: {
				request: { use: vi.fn(), eject: vi.fn() },
				response: { use: vi.fn(), eject: vi.fn() },
			},
		})),
	},
}));

vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { error: mocks.error, success: mocks.success }),
}));

import { handleRestartTorrent } from './addMagnet';

describe('handleRestartTorrent', () => {
	beforeEach(() => vi.clearAllMocks());

	// AllDebrid restarts only failed magnets and refuses the rest with
	// MAGNET_PROCESSING, which DMM reported as a bare "Failed to restart".
	it('says why AllDebrid refused to restart a magnet that has not failed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mocks.post.mockResolvedValue({ data: refused.response });

		await expect(handleRestartTorrent('key', 'ad:813291548')).rejects.toMatchObject({
			code: 'MAGNET_PROCESSING',
		});

		expect(mocks.post.mock.calls[0][1].toString()).toBe('id=813291548');
		expect(mocks.error.mock.calls[0][0]).toBe(
			'AllDebrid restarts only failed torrents; ad:813291548 is downloading or done.'
		);
	});
});
