import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvePairing, collectPairing, createPairing } from './devicePairing';
import * as kodi from './kodiPairing';

// A Redis that answers the four calls the store makes, so the key names can be read back.
const redisKeys = vi.hoisted(() => new Map<string, string>());
vi.mock('ioredis', () => ({
	default: class {
		async get(key: string) {
			return redisKeys.get(key) ?? null;
		}
		async set(key: string, value: string, ...flags: unknown[]) {
			// NX refuses a key that exists, XX (the only other mode used) one that does not.
			if (flags.includes('NX') === redisKeys.has(key)) return null;
			redisKeys.set(key, value);
			return 'OK';
		}
		async del(...keys: string[]) {
			return keys.filter((key) => redisKeys.delete(key)).length;
		}
	},
}));

const HOME = '203.0.113.7';
const ORIGIN = 'https://dmm.test';
const state = { 'rd:accessToken': '"token"' };

afterEach(() => {
	delete process.env.REDIS_URL;
	redisKeys.clear();
});

describe('devicePairing', () => {
	it('keeps a TV code and a Kodi code apart', async () => {
		const tv = await createPairing('tv', HOME, ORIGIN);
		const kodiPairing = await kodi.createPairing(HOME, ORIGIN);

		expect(await kodi.approvePairing(tv.userCode, { accounts: [], sponsor: null }, HOME)).toBe(
			'unknown'
		);
		expect(await approvePairing('tv', kodiPairing.userCode, () => ({ state }), HOME)).toBe(
			'unknown'
		);
		expect(await approvePairing('tv', tv.userCode, () => ({ state }), HOME)).toBe('ok');
		expect(await kodi.collectPairing(tv.deviceCode)).toBe('expired');
		expect(await collectPairing('tv', kodiPairing.deviceCode)).toBe('expired');

		expect(await collectPairing('tv', tv.deviceCode)).toEqual({ state });
		expect(await kodi.collectPairing(kodiPairing.deviceCode)).toBe('pending');
	});

	// Pairings live 10 minutes in Redis across a deploy, so Kodi's key names must not move.
	it("stores Kodi's pairings under the key names live ones use, and the TV's under its own", async () => {
		process.env.REDIS_URL = 'redis://test';
		const k = await kodi.createPairing(HOME, ORIGIN);
		await kodi.approvePairing(k.userCode, { accounts: [], sponsor: null }, HOME);
		const t = await createPairing('tv', HOME, ORIGIN);
		await approvePairing('tv', t.userCode, () => ({ state }), HOME);

		expect([...redisKeys.keys()].sort()).toEqual(
			[
				`kodi:pair:code:${k.userCode}`,
				`kodi:pair:device:${k.deviceCode}`,
				`kodi:pair:approved:${k.userCode}`,
				`tv:pair:code:${t.userCode}`,
				`tv:pair:device:${t.deviceCode}`,
				`tv:pair:approved:${t.userCode}`,
			].sort()
		);
		expect(await collectPairing('tv', t.deviceCode)).toEqual({ state });
		expect(redisKeys.has(`tv:pair:code:${t.userCode}`)).toBe(false);
	});
});
