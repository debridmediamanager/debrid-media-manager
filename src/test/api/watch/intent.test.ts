import { beforeEach, describe, expect, it, vi } from 'vitest';

const intentMocks = vi.hoisted(() => ({
	getIntent: vi.fn(),
	getInstantIntent: vi.fn(),
}));

vi.mock('@/utils/intent', () => intentMocks);

import watchHandler from '@/pages/api/watch/[os]/[player]';
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
	it('redirects when a standard intent exists', async () => {
		intentMocks.getIntent.mockResolvedValue('app://play');
		const res = createRes();

		await watchHandler(
			{
				query: { token: 'tok', link: 'link', os: 'ios', player: 'infuse' },
				headers: { 'x-real-ip': '3.3.3.3' },
				socket: { remoteAddress: '2.2.2.2' },
			} as any,
			res
		);

		expect(intentMocks.getIntent).toHaveBeenCalledWith(
			'tok',
			'link',
			'3.3.3.3',
			'ios',
			'infuse'
		);
		expect(res.redirect).toHaveBeenCalledWith(307, 'app://play');
	});

	it('returns 500 when the instant intent is missing', async () => {
		intentMocks.getInstantIntent.mockResolvedValue('');
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
		expect(res.json).toHaveBeenCalledWith({ error: 'No intent found for hash' });
	});
});
