import settingsHandler from '@/pages/api/admin/settings';
import { SiteSettingService } from '@/services/database/siteSettings';
import { _resetSiteSettingsForTest, getSiteSetting } from '@/services/siteSettings';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (wrapped: unknown) => wrapped };
});

const TOKEN = 'test-admin-token';
const AIO = 'https://aio.example/stremio/uuid/secret-password-xyz';

const call = async (
	init: Parameters<typeof createMockRequest>[0],
	token: string | null = TOKEN
) => {
	const res = createMockResponse();
	await settingsHandler(
		createMockRequest({
			...init,
			headers: token ? { authorization: `Bearer ${token}` } : {},
		}) as any,
		res as any
	);
	return res;
};

beforeEach(() => {
	vi.stubEnv('ADMIN_TOKEN', TOKEN);
	vi.stubEnv('SCRAPED_VERDICTS_DAILY_TOKENS', '11000000');
	vi.stubEnv('TORZNAB_SPONSOR_LIMITS', '');
	vi.stubEnv('AIOSTREAMS_URL', AIO);
	_resetSiteSettingsForTest();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	_resetSiteSettingsForTest();
});

describe('/api/admin/settings', () => {
	it('refuses without the admin token', async () => {
		const list = vi.spyOn(SiteSettingService.prototype, 'listSettings');
		expect((await call({ method: 'GET' }, null))._getStatusCode()).toBe(401);
		expect(list).not.toHaveBeenCalled();
	});

	it('says where each value comes from, and never sends a secret back', async () => {
		vi.spyOn(SiteSettingService.prototype, 'listSettings').mockResolvedValue([
			{ key: 'verdictsDailyTokens', value: '5000000' },
		]);
		const res = await call({ method: 'GET' });
		const { settings } = res._getData() as { settings: any[] };
		const byKey = Object.fromEntries(settings.map((s) => [s.key, s]));
		expect(byKey.verdictsDailyTokens).toMatchObject({ source: 'saved', value: '5000000' });
		expect(byKey.torznabSponsorLimits).toMatchObject({ source: 'unset', value: '' });
		expect(byKey.aiostreamsUrl).toMatchObject({
			source: 'environment',
			secret: true,
			value: 'https://aio.example/…xyz',
		});
		expect(JSON.stringify(res._getData())).not.toContain('secret-password');
	});

	it.each([
		['verdictsDailyTokens', '0', /whole number/],
		['verdictsDailyTokens', 'lots', /whole number/],
		['torznabSponsorLimits', 'ABCD=five', /SHORTID=N/],
		['torznabSponsorLimits', 'ABCD=0', /SHORTID=N/],
		['aiostreamsUrl', 'aio.example/stremio/u/p', /http\(s\)/],
		['nope', '1', /Unknown setting/],
	])('refuses %s = %j', async (key, value, error) => {
		const set = vi.spyOn(SiteSettingService.prototype, 'setSetting');
		const res = await call({ method: 'PUT', body: { key, value } });
		expect(res._getStatusCode()).toBe(400);
		expect((res._getData() as { error: string }).error).toMatch(error);
		expect(set).not.toHaveBeenCalled();
	});

	it('saves a normalized value, which then wins over the environment', async () => {
		const saved = new Map<string, string>();
		vi.spyOn(SiteSettingService.prototype, 'setSetting').mockImplementation(async (k, v) => {
			saved.set(k, v);
		});
		vi.spyOn(SiteSettingService.prototype, 'listSettings').mockImplementation(async () =>
			[...saved].map(([key, value]) => ({ key, value }))
		);
		expect(await getSiteSetting('verdictsDailyTokens')).toBe('11000000');

		await call({
			method: 'PUT',
			body: { key: 'torznabSponsorLimits', value: ' ABCD = 5\nEF12=02,\n' },
		});
		await call({ method: 'PUT', body: { key: 'verdictsDailyTokens', value: '20,000,000' } });
		expect(saved.get('torznabSponsorLimits')).toBe('ABCD=5,EF12=2');
		// the save cleared this instance's copy, so the new values apply at once
		expect(await getSiteSetting('verdictsDailyTokens')).toBe('20000000');
		expect(await getSiteSetting('torznabSponsorLimits')).toBe('ABCD=5,EF12=2');
	});

	it('goes back to the environment variable on delete', async () => {
		const remove = vi.spyOn(SiteSettingService.prototype, 'removeSetting').mockResolvedValue();
		const res = await call({ method: 'DELETE', body: { key: 'aiostreamsUrl' } });
		expect(res._getStatusCode()).toBe(200);
		expect(remove).toHaveBeenCalledWith('aiostreamsUrl');
	});
});

describe('getSiteSetting', () => {
	it('keeps the environment value when the table cannot be read', async () => {
		vi.spyOn(SiteSettingService.prototype, 'listSettings').mockRejectedValue(
			new Error('db down')
		);
		expect(await getSiteSetting('aiostreamsUrl')).toBe(AIO);
	});
});
