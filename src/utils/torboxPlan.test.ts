import planRestricted from '@/test/fixtures/torbox/createtorrent-plan-restricted-2026-09-23.json';
import badToken from '@/test/fixtures/torbox/user-me-bad-token-2026-09-24.json';
import standardPlan from '@/test/fixtures/torbox/user-me-standard-plan-2026-09-24.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFreeTorBoxPlan } from './torboxPlan';

type Captured = { status: number; body: unknown };

const answer = ({ status, body }: Captured) => {
	global.fetch = vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	}) as any;
};

// The same captured account, moved to the free plan. No free account was on hand
// to capture `/user/me` from, so this is the one hand-edited shape here.
const freePlan: Captured = {
	status: 200,
	body: { ...standardPlan.body, data: { ...standardPlan.body.data, plan: 0 } },
};

afterEach(() => vi.restoreAllMocks());

describe('isFreeTorBoxPlan', () => {
	it('asks /user/me with the key as a bearer token', async () => {
		answer(standardPlan);
		await isFreeTorBoxPlan('tb-key');

		const [url, init] = vi.mocked(global.fetch).mock.calls[0];
		expect(url).toBe('https://api.torbox.app/v1/api/user/me');
		expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tb-key' });
	});

	it('refuses an account on plan 0', async () => {
		answer(freePlan);
		expect(await isFreeTorBoxPlan('tb-key')).toBe(true);
	});

	// If TorBox closes /user/me to a free account the way it closes createtorrent,
	// the refusal is itself the answer. This is the body the uploader recorded
	// for a free account's job on 2026-09-23.
	it('refuses an account whose /user/me answers PLAN_RESTRICTED_FEATURE', async () => {
		answer(planRestricted);
		expect(await isFreeTorBoxPlan('tb-key')).toBe(true);
	});

	it('admits a paid account', async () => {
		answer(standardPlan);
		expect(await isFreeTorBoxPlan('tb-key')).toBe(false);
	});

	// A bad key is also a 403, so the status alone would refuse it as free.
	it('admits a key TorBox rejects as BAD_TOKEN, leaving the uploader to report it', async () => {
		answer(badToken);
		expect(await isFreeTorBoxPlan('tb-key')).toBe(false);
	});

	it('admits when TorBox is rate limiting', async () => {
		answer({ status: 429, body: 'rate limit exceeded' });
		expect(await isFreeTorBoxPlan('tb-key')).toBe(false);
	});

	it('admits when TorBox cannot be reached', async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as any;
		expect(await isFreeTorBoxPlan('tb-key')).toBe(false);
	});
});
