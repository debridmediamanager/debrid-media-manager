import handler from '@/pages/api/stremio/[userid]/play/[link]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ hash: vi.fn(), redeem: vi.fn() }));
vi.mock('@/services/repository', () => ({
	repository: { getCastProfile: vi.fn().mockResolvedValue({}), getHashByLink: mocks.hash },
}));
vi.mock('@/utils/castRdToken', () => ({
	castAccessToken: vi.fn().mockResolvedValue('token'),
	forgetCastAccessToken: vi.fn(),
}));
vi.mock('@/services/realDebrid', () => ({ unrestrictLink: mocks.redeem }));
vi.mock('@/services/takedown/blocklist', () => ({
	setBlocklistForTests: vi.fn(),
	BLOCKED_MESSAGE: 'Blocked',
	getBlocklist: vi.fn().mockResolvedValue({ hashes: new Set(['blocked']) }),
	isHashBlockedIn: (_: unknown, hash: string) => hash === 'blocked',
}));
beforeEach(() => {
	vi.clearAllMocks();
	mocks.redeem.mockResolvedValue({ download: 'https://delivery.test/file' });
});
it.each(['missing', 'database error'])(
	'does not redeem when hash attribution is %s while takedowns are active',
	async (kind) => {
		if (kind === 'missing') mocks.hash.mockResolvedValue(null);
		else mocks.hash.mockRejectedValue(new Error('offline'));
		await handler(
			createMockRequest({
				headers: { 'x-real-ip': '127.0.0.1' },
				query: { userid: 'user', link: 'ABCDEFGHIJKLM' },
			}),
			createMockResponse()
		);
		expect(mocks.redeem).not.toHaveBeenCalled();
	}
);
