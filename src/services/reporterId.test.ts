import { describe, expect, it } from 'vitest';
import { JEV_REPORTER, storedReporterId } from './reporterId';

describe('storedReporterId', () => {
	it('keeps Real-Debrid, AllDebrid and TorBox keys as sent', () => {
		expect(storedReporterId('ABC123')).toBe('ABC123');
	});

	it('stores tagged credentials as a digest under their tag', () => {
		expect(storedReporterId('pm:secret')).toMatch(/^pm:[0-9a-f]{64}$/);
	});

	it('never stores the Jev reporter id a client sends', () => {
		expect(storedReporterId(JEV_REPORTER)).not.toBe(JEV_REPORTER);
		expect(storedReporterId(JEV_REPORTER)).toMatch(/^jev:[0-9a-f]{64}$/);
	});
});
