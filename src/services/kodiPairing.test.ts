import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	approvePairing,
	collectPairing,
	createPairing,
	formatUserCode,
	normalizeUserCode,
	PAIRING_TTL_SECONDS,
} from './kodiPairing';

const link = {
	accounts: [{ service: 'rd', name: 'Real-Debrid', addon: 'x/api/stremio/abc123' }],
	sponsor: null,
};
const HOME = '203.0.113.7';

afterEach(() => vi.useRealTimers());

describe('kodiPairing (memory store)', () => {
	it('hands the approved link to the device once, then forgets both codes', async () => {
		const { userCode, deviceCode } = await createPairing(HOME);
		expect(normalizeUserCode(formatUserCode(userCode))).toBe(userCode);

		expect(await collectPairing(deviceCode)).toBe('pending');
		expect(await approvePairing(userCode, link, HOME)).toBe('ok');
		expect(await approvePairing(userCode, link, HOME)).toBe('used');
		expect(await collectPairing(deviceCode)).toEqual(link);
		expect(await collectPairing(deviceCode)).toBe('expired');
		expect(await approvePairing(userCode, link, HOME)).toBe('unknown');
	});

	it('asks before linking a Kodi on another connection, as a phishing link would be', async () => {
		const { userCode, deviceCode } = await createPairing(HOME);
		expect(await approvePairing(userCode, link, '198.51.100.9')).toBe('other-network');
		expect(await collectPairing(deviceCode)).toBe('pending');
		expect(await approvePairing(userCode, link, '198.51.100.9', true)).toBe('ok');
		expect(await collectPairing(deviceCode)).toEqual(link);
	});

	it('lets only one of two racing approvals and one of two racing polls through', async () => {
		const { userCode, deviceCode } = await createPairing(HOME);
		const approvals = await Promise.all([
			approvePairing(userCode, link, HOME),
			approvePairing(
				userCode,
				{ ...link, sponsor: { apiKey: 'k', githubUsername: 'x' } },
				HOME
			),
		]);
		expect(approvals.sort()).toEqual(['ok', 'used']);
		const polls = await Promise.all([collectPairing(deviceCode), collectPairing(deviceCode)]);
		expect(polls.filter((p) => typeof p === 'object')).toHaveLength(1);
	});

	it('expires an unapproved code, and approval neither extends nor revives it', async () => {
		vi.useFakeTimers();
		const { userCode, deviceCode } = await createPairing(HOME);
		vi.advanceTimersByTime((PAIRING_TTL_SECONDS - 10) * 1000);
		expect(await approvePairing(userCode, link, HOME)).toBe('ok');
		vi.advanceTimersByTime(11 * 1000);
		expect(await collectPairing(deviceCode)).toBe('expired');
		expect(await approvePairing(userCode, link, HOME)).toBe('unknown');
	});

	it('reads codes the way people type them and refuses the look-alikes it never issues', () => {
		expect(normalizeUserCode(' abcd-efgh ')).toBe('ABCDEFGH');
		expect(normalizeUserCode('ABCD EFGH')).toBe('ABCDEFGH');
		expect(normalizeUserCode('ABCD-EFG0')).toBeNull();
		expect(normalizeUserCode('ABCDEFG')).toBeNull();
		expect(normalizeUserCode(42)).toBeNull();
	});
});
