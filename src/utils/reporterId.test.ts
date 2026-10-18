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
