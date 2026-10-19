import resources from '@/test/fixtures/rexDirect/plex-resources-2026-10-19.json';
import { ownsServer, plexServerOwner } from '@/utils/plexServerOwner';
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
	afterEach(() => vi.unstubAllGlobals());

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
});
