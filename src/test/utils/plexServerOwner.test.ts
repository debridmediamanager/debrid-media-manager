import resources from '@/test/fixtures/rexDirect/plex-resources-2026-10-19.json';
import cadence from '@/test/fixtures/rexDirect/register-cadence-2026-11-15.json';
import { clearOwnerCache, ownsServer, plexServerOwner } from '@/utils/plexServerOwner';
import { afterEach, describe, expect, it, vi } from 'vitest';

// plex.tv's /api/v2/resources for fun-rex's own server token, 2026-10-19 (tokens and
// addresses dropped). It lists every device on the account, not just this server.
const FUN_REX = '45d6b93c3f472650d0a3830d5d3415819ec7bfc1';
const PLEXLAB = '78a364ad887787f74e834a5c48c987d3e6fb165a';
const CONTROLLER = 'e5edd1605f40eb264066539e7182fe9fd7801818';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

describe('ownsServer', () => {
	it('finds the claimed server among the account devices', () => {
		expect(ownsServer(resources, FUN_REX)).toBe(true);
		expect(ownsServer(resources, PLEXLAB)).toBe(true);
	});

	it('refuses a device that is not a server, and one the account does not list', () => {
		expect(ownsServer(resources, CONTROLLER)).toBe(false);
		expect(ownsServer(resources, 'ab'.repeat(20))).toBe(false);
	});

	it('refuses a server shared with the account rather than owned by it', () => {
		const shared = resources.map((r) =>
			r.clientIdentifier === FUN_REX ? { ...r, owned: false } : r
		);
		expect(ownsServer(shared, FUN_REX)).toBe(false);
	});
});

describe('plexServerOwner', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		clearOwnerCache();
	});

	it('answers the account id for the owner of the server', async () => {
		const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
			url.endsWith('/resources') ? json(resources) : json({ id: 316687974 })
		);
		vi.stubGlobal('fetch', fetch);
		expect(await plexServerOwner('tok', FUN_REX)).toEqual({ accountId: '316687974' });
		expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
			'X-Plex-Token': 'tok',
			'X-Plex-Client-Identifier': FUN_REX,
		});
	});

	it('passes on a refused token as 401 and an unowned server as 403', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({ errors: [] }, 401))
		);
		expect(await plexServerOwner('bad', FUN_REX)).toMatchObject({ status: 401 });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json(resources))
		);
		expect(await plexServerOwner('tok', CONTROLLER)).toMatchObject({ status: 403 });
	});

	// Each plex.tv call with the server's token hides the server from the account's
	// Plex apps until it announces again, so a confirmed owner is not asked again.
	const plexTv = (owned = resources) =>
		vi.fn(async (url: string, _init?: RequestInit) =>
			url.endsWith('/resources') ? json(owned) : json({ id: 316687974 })
		);
	const asks = (fetch: ReturnType<typeof plexTv>) =>
		fetch.mock.calls.filter(([url]) => url.endsWith('/resources')).length;

	it('asks plex.tv once a day about a running server, not on each of its registrations', async () => {
		vi.useFakeTimers();
		const start = Date.parse('2026-11-15T11:12:21Z');
		const unlisted = resources.filter((r) => r.clientIdentifier !== FUN_REX);
		const fetch = plexTv();
		vi.stubGlobal('fetch', fetch);
		let unlistedAsks = 0;
		for (const { t, status } of cadence.requests) {
			vi.setSystemTime(start + t * 1000);
			// The claim's first registration comes before plex.tv lists the server.
			fetch.mockImplementation(async (url: string) =>
				url.endsWith('/resources')
					? json(status === 403 ? (unlistedAsks++, unlisted) : resources)
					: json({ id: 316687974 })
			);
			const owner = await plexServerOwner('tok', FUN_REX);
			expect(owner).toEqual(
				status === 403
					? expect.objectContaining({ status: 403 })
					: { accountId: '316687974' }
			);
		}
		// The 403, the 202 that first found it owned, and once more a day after that.
		expect(unlistedAsks).toBe(1);
		expect(asks(fetch)).toBe(3);
		expect(cadence.requests).toHaveLength(22);
	});

	it('asks again for a new token, and never answers a different token from the kept one', async () => {
		const fetch = plexTv();
		vi.stubGlobal('fetch', fetch);
		await plexServerOwner('tok', FUN_REX);
		await plexServerOwner('tok', FUN_REX);
		expect(asks(fetch)).toBe(1);

		fetch.mockImplementation(async () => json({ errors: [] }, 401));
		expect(await plexServerOwner('stolen', FUN_REX)).toMatchObject({ status: 401 });
		expect(asks(fetch)).toBe(2);

		fetch.mockImplementation(plexTv().getMockImplementation()!);
		expect(await plexServerOwner('new', FUN_REX)).toEqual({ accountId: '316687974' });
		expect(asks(fetch)).toBe(3);
		// The new token replaced the old one's answer.
		fetch.mockImplementation(async () => json({ errors: [] }, 401));
		expect(await plexServerOwner('tok', FUN_REX)).toMatchObject({ status: 401 });
	});

	it('asks again once a day has passed since plex.tv confirmed it', async () => {
		vi.useFakeTimers();
		const fetch = plexTv();
		vi.stubGlobal('fetch', fetch);
		await plexServerOwner('tok', FUN_REX);
		vi.advanceTimersByTime(24 * 3600_000 - 1000);
		await plexServerOwner('tok', FUN_REX);
		expect(asks(fetch)).toBe(1);
		vi.advanceTimersByTime(2000);
		await plexServerOwner('tok', FUN_REX);
		expect(asks(fetch)).toBe(2);
	});

	it('keeps no refusal: 401, 403 and a plex.tv error are asked again each time', async () => {
		for (const [fetch, status] of [
			[vi.fn(async () => json({ errors: [] }, 401)), 401],
			[plexTv(resources.filter((r) => r.clientIdentifier !== FUN_REX)), 403],
			[vi.fn(async () => json({}, 503)), 502],
		] as const) {
			vi.stubGlobal('fetch', fetch);
			expect(await plexServerOwner('tok', FUN_REX)).toMatchObject({ status });
			expect(await plexServerOwner('tok', FUN_REX)).toMatchObject({ status });
			expect(fetch).toHaveBeenCalledTimes(2);
		}
	});
});
