import { describe, expect, it } from 'vitest';
import { searchStateFromStatusHeader } from './searchNotice';

describe('searchStateFromStatusHeader', () => {
	it('keeps the processing notice', () => {
		expect(searchStateFromStatusHeader('processing')).toBe('processing');
	});

	it('stays silent for a queued scrape request', () => {
		expect(searchStateFromStatusHeader('requested')).toBe('loaded');
	});

	it('falls back to loaded for a missing or unknown status', () => {
		expect(searchStateFromStatusHeader(undefined)).toBe('loaded');
		expect(searchStateFromStatusHeader('')).toBe('loaded');
		expect(searchStateFromStatusHeader('something-new')).toBe('loaded');
	});
});
