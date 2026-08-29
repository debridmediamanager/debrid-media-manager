import { describe, expect, it } from 'vitest';
import { exceedsTransferSizeCap, MAX_TRANSFER_BYTES, tooLargeMessage } from './transferSize';

describe('exceedsTransferSizeCap', () => {
	// The population this exists for: measured over 30 days across both uploader
	// hosts, 0 of 14 releases above 200 GB ever completed and they burned 6.05 TB
	// failing. A 100 GB cap refuses 29 magnets carrying 8.76 TB a month.
	it('refuses a release over the cap', () => {
		expect(exceedsTransferSizeCap(600.5e9)).toBe(true);
		expect(exceedsTransferSizeCap(MAX_TRANSFER_BYTES + 1)).toBe(true);
	});

	it('admits everything up to and including the cap', () => {
		expect(exceedsTransferSizeCap(MAX_TRANSFER_BYTES)).toBe(false);
		expect(exceedsTransferSizeCap(50e9)).toBe(false);
		expect(exceedsTransferSizeCap(1)).toBe(false);
	});

	// A result that has never been through an availability check has no size, and
	// the service settles it 4-12s into the job anyway. Blocking on a missing
	// number would deny transfers that are fine.
	it('never refuses a release whose size is unknown', () => {
		expect(exceedsTransferSizeCap(undefined)).toBe(false);
		expect(exceedsTransferSizeCap(null)).toBe(false);
		expect(exceedsTransferSizeCap(0)).toBe(false);
		expect(exceedsTransferSizeCap(-1)).toBe(false);
		expect(exceedsTransferSizeCap(Number.NaN)).toBe(false);
		expect(exceedsTransferSizeCap(Number.POSITIVE_INFINITY)).toBe(false);
	});

	it('treats a zero cap as the limit being off', () => {
		expect(exceedsTransferSizeCap(5000e9, 0)).toBe(false);
	});

	// The number the `debrid` service enforces. If these drift, DMM either blocks
	// a release the service would take or promises one it will refuse.
	it('matches the cap the uploader service enforces', () => {
		expect(MAX_TRANSFER_BYTES).toBe(100 * 1e9);
	});
});

describe('tooLargeMessage', () => {
	it('names the release size and the limit', () => {
		expect(tooLargeMessage(600.5e9)).toBe(
			'too large to transfer — 600.5 GB, over the 100 GB limit'
		);
	});
});
