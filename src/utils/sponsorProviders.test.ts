import { describe, expect, it } from 'vitest';
import {
	isTorznabLiveService,
	LIVE_SERVICE_LABELS,
	maskProviderKey,
	TORZNAB_LIVE_SERVICES,
} from './sponsorProviders';

describe('TORZNAB_LIVE_SERVICES', () => {
	// RD and AD are answered from DMM's own tables, so they need no credential
	// and must never appear in a form that asks for one. Debrid-Link has no
	// non-mutating availability check at all.
	it('offers only the providers that have to be asked', () => {
		expect(TORZNAB_LIVE_SERVICES).toEqual(['tb', 'pm', 'oc']);
	});

	it('labels every service it offers', () => {
		for (const service of TORZNAB_LIVE_SERVICES) {
			expect(LIVE_SERVICE_LABELS[service]).toBeTruthy();
		}
	});
});

describe('isTorznabLiveService', () => {
	it.each(['tb', 'pm', 'oc'])('accepts %s', (service) => {
		expect(isTorznabLiveService(service)).toBe(true);
	});

	it.each(['rd', 'ad', 'dl', 'cached', '', 'TB'])('rejects %s', (value) => {
		expect(isTorznabLiveService(value)).toBe(false);
	});

	it('rejects a non-string', () => {
		expect(isTorznabLiveService(undefined)).toBe(false);
		expect(isTorznabLiveService({ service: 'tb' })).toBe(false);
	});
});

describe('maskProviderKey', () => {
	it('keeps enough to recognise the key and not enough to use it', () => {
		const key = 'abcd' + 'x'.repeat(20) + 'wxyz';

		const masked = maskProviderKey(key);

		expect(masked.startsWith('abcd')).toBe(true);
		expect(masked.endsWith('wxyz')).toBe(true);
		expect(masked).not.toContain('xxxxxxxx');
	});

	it('shows nothing at all of a key too short to mask', () => {
		expect(maskProviderKey('short')).toBe('•••••');
	});
});
