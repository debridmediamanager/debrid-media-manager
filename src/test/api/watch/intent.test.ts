import { beforeEach, describe, expect, it, vi } from 'vitest';

const intentMocks = vi.hoisted(() => ({
	getInstantIntent: vi.fn(),
	isWatchService: (v: unknown) => v === 'rd' || v === 'ad' || v === 'tb',
}));

vi.mock('@/utils/intent', () => intentMocks);

import instantHandler from '@/pages/api/watch/instant/[os]/[player]';

const createRes = () => {
	const res: any = {
		status: vi.fn().mockReturnThis(),
		json: vi.fn(),
		redirect: vi.fn(),
	};
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API watch intents', () => {
	it('returns 500 when the instant intent is missing', async () => {
		intentMocks.getInstantIntent.mockResolvedValue({ error: 'Failed to add magnet: bad hash' });
		const res = createRes();

		await instantHandler(
			{
				query: { token: 'tok', hash: 'hash', fileId: '7', os: 'android', player: 'vlc' },
				headers: {},
				socket: { remoteAddress: '5.5.5.5' },
			} as any,
			res
		);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to add magnet: bad hash' });
	});
});
