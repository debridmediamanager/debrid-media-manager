import { describe, expect, it } from 'vitest';
import {
	MAX_OTHER_STREAMS_LIMIT,
	SPONSOR_MAX_OTHER_STREAMS_LIMIT,
	maxOtherStreamsLimit,
	otherStreamsLimitOptions,
} from './sponsorLimits';

describe('maxOtherStreamsLimit', () => {
	it('caps a non-sponsor at the standard limit', () => {
		expect(maxOtherStreamsLimit(false)).toBe(MAX_OTHER_STREAMS_LIMIT);
	});

	it('raises a sponsor to the sponsor limit', () => {
		expect(maxOtherStreamsLimit(true)).toBe(SPONSOR_MAX_OTHER_STREAMS_LIMIT);
	});
});

describe('otherStreamsLimitOptions', () => {
	it('offers 0 through 5 to a non-sponsor', () => {
		expect(otherStreamsLimitOptions(false)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('offers 0 through 10 to a sponsor', () => {
		expect(otherStreamsLimitOptions(true)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	// A sponsor who picked 10 and then lapsed still has 10 stored. Dropping it
	// from the list would render the select blank and misreport the profile.
	it('keeps a stored value that sits above the ceiling', () => {
		expect(otherStreamsLimitOptions(false, 10)).toEqual([0, 1, 2, 3, 4, 5, 10]);
	});

	it('does not duplicate a stored value already in range', () => {
		expect(otherStreamsLimitOptions(true, 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it('ignores a non-integer stored value', () => {
		expect(otherStreamsLimitOptions(false, NaN)).toEqual([0, 1, 2, 3, 4, 5]);
	});
});
