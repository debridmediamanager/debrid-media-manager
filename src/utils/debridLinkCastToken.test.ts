import { DebridLinkError } from '@/services/debridLink';
import { repository } from '@/services/repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDebridLinkCastToken } from './debridLinkCastToken';

vi.mock('@/services/repository');
const db = vi.mocked(repository);
const profile = { apiKey: 'expired', refreshToken: 'refresh' };
const response = (body: unknown) =>
	new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', fetchMock);
	db.getDebridLinkCastProfile = vi.fn().mockResolvedValue(profile);
	db.saveDebridLinkCastProfile = vi.fn().mockResolvedValue({});
});
afterEach(() => vi.unstubAllGlobals());

const expired = () => new DebridLinkError('Expired', 'badToken');
const operation = () =>
	vi.fn(async (token: string) => {
		if (token === 'expired') throw expired();
		return `playable:${token}`;
	});

describe('Cast credential renewal', () => {
	it('coalesces simultaneous expired plays and preserves a refresh token omitted by OAuth', async () => {
		fetchMock.mockResolvedValue(response({ access_token: 'fresh', expires_in: 86400 }));
		const [first, second] = await Promise.all([
			withDebridLinkCastToken('viewer', profile, operation()),
			withDebridLinkCastToken('viewer', profile, operation()),
		]);
		expect([first, second]).toEqual(['playable:fresh', 'playable:fresh']);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(db.saveDebridLinkCastProfile).toHaveBeenCalledTimes(1);
		expect(db.saveDebridLinkCastProfile.mock.calls[0].at(-1)).toBe('refresh');
	});

	it('reuses a token already renewed by another worker rather than spending a stale refresh token', async () => {
		db.getDebridLinkCastProfile = vi.fn().mockResolvedValue({ ...profile, apiKey: 'newer' });
		expect(await withDebridLinkCastToken('viewer', profile, operation())).toBe(
			'playable:newer'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not retry unrelated refusals or a pasted API key', async () => {
		const quota = new DebridLinkError('Quota', 'maxTorrent');
		await expect(
			withDebridLinkCastToken('viewer', profile, vi.fn().mockRejectedValue(quota))
		).rejects.toBe(quota);
		await expect(
			withDebridLinkCastToken('viewer', { apiKey: 'expired' }, operation())
		).rejects.toMatchObject({ code: 'badToken' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('stops after one refresh even when the replacement access token is rejected', async () => {
		fetchMock.mockResolvedValue(response({ access_token: 'fresh' }));
		const rejected = vi.fn().mockRejectedValue(expired());
		await expect(withDebridLinkCastToken('viewer', profile, rejected)).rejects.toMatchObject({
			code: 'badToken',
		});
		expect(rejected).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
