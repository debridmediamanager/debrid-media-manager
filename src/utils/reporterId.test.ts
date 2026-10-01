import { storedReporterId } from '@/services/reporterId';
import { describe, expect, it } from 'vitest';
import { canReportWith, reporterIdFor } from './reporterId';

describe('reporterIdFor', () => {
	it('keeps the key an RD, AD or TorBox reporter has always been counted by', () => {
		expect(reporterIdFor({ rdKey: 'rd', adKey: 'ad' })).toBe('rd');
		expect(reporterIdFor({ adKey: 'ad', torboxKey: 'tb' })).toBe('ad');
		expect(reporterIdFor({ torboxKey: 'tb', premiumizeKey: 'pm' })).toBe('tb');
	});

	it('lets a user of any other service report, tagged for the server to digest', () => {
		expect(reporterIdFor({ premiumizeKey: 'pm' })).toBe('pm:pm');
		expect(reporterIdFor({ offcloudKey: 'oc' })).toBe('oc:oc');
		expect(reporterIdFor({ debridLinkKey: 'dl' })).toBe('dl:dl');
	});

	it('has no reporter without a signed-in service', () => {
		expect(reporterIdFor({})).toBe('');
		expect(canReportWith({ rdKey: null })).toBe(false);
		expect(canReportWith({ debridLinkKey: 'dl' })).toBe(true);
	});
});

describe('storedReporterId', () => {
	it('digests a tagged credential, stably and per service', () => {
		const once = storedReporterId('oc:key-1');
		expect(once).toMatch(/^oc:[0-9a-f]{64}$/);
		expect(storedReporterId('oc:key-1')).toBe(once);
		expect(storedReporterId('oc:key-2')).not.toBe(once);
		expect(storedReporterId('dl:key-1').slice(3)).toBe(once.slice(3));
	});

	it('leaves every other id as sent', () => {
		expect(storedReporterId('ABCDEF123')).toBe('ABCDEF123');
	});
});
