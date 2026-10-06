// @vitest-environment node
import handler from '@/pages/api/watch/resolve/[os]/[player]';
import playRecorded from '@/test/fixtures/castAddonFailures/play-failures-2026-10-04.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Card 229. Watching an AllDebrid library file from the web app posts its
 * locked `/f/` link here, and DMM's server unlocks it with the member's key.
 * AllDebrid holds a key used from an address it has not seen for the account
 * until the owner confirms the email it sends, and DMM's server is such an
 * address, so the unlock answers AUTH_BLOCKED inside an HTTP 200. This route
 * turned that into a 500 carrying AllDebrid's half-sentence of HTML.
 *
 * The answer is card 224's recording of that refusal, served to the real
 * AllDebrid client through an axios adapter so its envelope parsing runs.
 */

type Reply = { status: number; contentType: string; body: unknown };

const net = vi.hoisted(() => ({ reply: null as Reply | null, calls: [] as string[] }));

vi.mock('axios', async (importOriginal) => {
	const actual = await importOriginal<typeof import('axios')>();
	const axios = actual.default;
	axios.defaults.adapter = async (config) => {
		net.calls.push(`${(config.method ?? 'get').toUpperCase()} ${axios.getUri(config)}`);
		const reply = net.reply!;
		return {
			data: JSON.stringify(reply.body),
			status: reply.status,
			statusText: '',
			headers: new actual.AxiosHeaders({ 'content-type': reply.contentType }),
			config,
			request: {},
		};
	};
	return actual;
});

vi.mock('@/utils/clientIp', () => ({ getClientIpFromRequest: () => '192.0.2.10' }));

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { allDebridHostname: 'https://api.alldebrid.com' } }),
}));

const LOCKED_LINK = 'https://alldebrid.com/f/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

beforeEach(() => {
	net.reply = null;
	net.calls = [];
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

const resolve = async () => {
	const res = createMockResponse();
	await handler(
		createMockRequest({
			method: 'POST',
			query: { os: 'windows', player: 'vlc' },
			body: { token: 'ad-key', service: 'ad', hash: 'abc', link: LOCKED_LINK },
		}),
		res
	);
	return res;
};

describe('/api/watch/resolve with an AllDebrid sign-in held for confirmation', () => {
	it('answers 403 telling the member to confirm the email, not a 500', async () => {
		net.reply = playRecorded.responses['ad-unlock-auth-blocked'];

		const res = await resolve();

		expect(net.calls).toEqual(['POST https://api.alldebrid.com/v4.1/link/unlock']);
		expect(res._getStatusCode()).toBe(403);
		const body = res._getData() as { error: string; reason: string };
		expect(body.reason).toBe('confirm');
		expect(body.error).toMatch(/AllDebrid/);
		expect(body.error).toMatch(/email/);
		expect(body.error).toMatch(/confirm/);
		// AllDebrid's own message is a fragment of HTML; the member reads this.
		expect(body.error).not.toMatch(/<b>/);
	});

	it('still unlocks a link AllDebrid accepts', async () => {
		net.reply = playRecorded.responses['ad-unlock-success'];

		const res = await resolve();

		expect(res._getStatusCode()).toBe(200);
		expect((res._getData() as { intent: string }).intent).toMatch(/^vlc:\/\//);
	});
});
