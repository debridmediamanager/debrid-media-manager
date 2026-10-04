// @vitest-environment node
import recorded from '@/test/fixtures/castAddonFailures/play-failures-2026-10-04.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _testing, getTorrentList } from './torbox';

/**
 * Card 220: TorBox stalls on the server.
 *
 * TorBox's 429 locks one key out for its Retry-After - 300 s, measured
 * 2026-08-02, and requests made during it do not extend it. On the server this
 * client serves every member at once, and it used to record that lockout for
 * everyone and sit it out inside the request: one member's 429 held every
 * member's stream list and play in that process for five minutes, which the
 * proxy cut at 60 s.
 */

type Reply = {
	status: number;
	contentType: string;
	body: unknown;
	headers?: Record<string, string>;
};

const net = vi.hoisted(() => ({
	byKey: new Map<string, Reply>(),
	calls: [] as string[],
}));

vi.mock('axios', async (importOriginal) => {
	const actual = await importOriginal<typeof import('axios')>();
	const axios = actual.default;
	axios.defaults.adapter = async (config) => {
		const auth = new actual.AxiosHeaders(config.headers).get('Authorization');
		const key = typeof auth === 'string' ? auth.replace(/^Bearer /, '') : '';
		net.calls.push(`${key} ${axios.getUri(config)}`);
		const reply = net.byKey.get(key);
		if (!reply) throw new Error(`No recorded answer for key ${key}`);
		const response = {
			data: typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
			status: reply.status,
			statusText: '',
			headers: new actual.AxiosHeaders({
				'content-type': reply.contentType,
				...reply.headers,
			}),
			config,
			request: {},
		};
		if (reply.status < 300) return response;
		throw new actual.AxiosError(
			`Request failed with status code ${reply.status}`,
			'ERR_BAD_REQUEST',
			config,
			{},
			response
		);
	};
	return actual;
});

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { torboxHostname: 'https://api.torbox.app' } }),
}));
vi.mock('@/lib/observability/torboxOperationalStats', () => ({
	recordTorBoxOperationEvent: vi.fn(),
	resolveTorBoxOperation: vi.fn(() => null),
}));

const lockout = recorded.responses['tb-rate-limited'] as Reply;

beforeEach(() => {
	_testing.resetState();
	net.byKey.clear();
	net.calls.length = 0;
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('TorBox lockouts on the server', () => {
	it("does not hold one member's call behind another member's lockout", async () => {
		net.byKey.set('locked-key', lockout);
		net.byKey.set('other-key', {
			status: 200,
			contentType: 'application/json',
			body: { success: true, data: [] },
		});

		const locked = getTorrentList('locked-key').catch((error: Error) => error);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(await locked).toMatchObject({ name: 'TorBoxRateLimitError' });

		let other: unknown;
		void getTorrentList('other-key').then((value) => {
			other = value;
		});
		await vi.advanceTimersByTimeAsync(1_000);

		expect(other).toEqual({ success: true, data: [] });
	});

	it('does not ask TorBox again for a key that is locked out', async () => {
		net.byKey.set('locked-key', lockout);

		await getTorrentList('locked-key').catch(() => undefined);
		const second = getTorrentList('locked-key').catch((error: Error) => error);
		await vi.advanceTimersByTimeAsync(1_000);

		expect(await second).toMatchObject({ name: 'TorBoxRateLimitError' });
		expect(net.calls).toHaveLength(1);
	});

	// An edge 5xx is still retried, but only while the wait stays short: the
	// caller is an HTTP request, not a job that can wait two minutes.
	it('gives up on a failing call within seconds rather than minutes', async () => {
		net.byKey.set('key', {
			status: 502,
			contentType: 'text/html',
			body: '<html>bad gateway</html>',
		});

		let settled: unknown;
		void getTorrentList('key').catch((error: { response?: { status?: number } }) => {
			settled = error.response?.status;
		});
		await vi.advanceTimersByTimeAsync(10_000);

		expect(settled).toBe(502);
		expect(net.calls.length).toBeGreaterThan(1);
	});
});
