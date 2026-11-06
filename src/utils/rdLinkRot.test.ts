import sample from '@/test/fixtures/castWindow/record-link-age-sample-2026-11-06.json';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import {
	CACHED_RECORD_MAX_AGE_MS,
	cachedRecordCutoff,
	isDeadRdLink,
	RD_LINK_MAX_AGE_MS,
	rdErrorOf,
	rdLinkCutoff,
} from './rdLinkRot';

const rdError = (error: string, status: number) =>
	new AxiosError('rd', 'ERR', undefined, undefined, {
		status,
		statusText: '',
		headers: new AxiosHeaders(),
		config: { headers: new AxiosHeaders() },
		data: { error },
	});

describe('isDeadRdLink', () => {
	it('treats an aged-out link as dead', () => {
		expect(isDeadRdLink(rdError('hoster_unavailable', 503))).toBe(true);
	});

	it('treats evicted content as dead', () => {
		expect(isDeadRdLink(rdError('unavailable_file', 404))).toBe(true);
	});

	// The unrestrict throttle fires after a handful of calls seconds apart, which
	// is exactly what Stremio resolving several streams at once looks like.
	// Reading it as rot would delete rows for content that is perfectly alive.
	it('does not treat the unrestrict throttle as dead', () => {
		expect(isDeadRdLink(rdError('too_many_requests', 429))).toBe(false);
	});

	it('does not treat a name block as dead', () => {
		expect(isDeadRdLink(rdError('infringing_file', 451))).toBe(false);
	});

	// Real-Debrid's 403 is about the account (locked, not premium) or the
	// caller's address. Reading one as rot deleted the link for every member.
	it.each([401, 403])('never treats a %i as dead, whatever the body names', (status) => {
		expect(isDeadRdLink(rdError('unavailable_file', status))).toBe(false);
		expect(isDeadRdLink(rdError('hoster_unavailable', status))).toBe(false);
	});

	it('does not treat a server error or a non-Axios failure as dead', () => {
		expect(isDeadRdLink(rdError('internal_error', 500))).toBe(false);
		expect(isDeadRdLink(new Error('socket hang up'))).toBe(false);
		expect(rdErrorOf(new Error('socket hang up'))).toBeNull();
	});
});

const DAY = 24 * 60 * 60 * 1000;
const playRate = (provider: string, band: string) => {
	const rows = sample.samples.filter((r) => r.provider === provider && r.ageDays === band);
	return rows.filter((r) => r.verdict === 'plays').length / rows.length;
};

describe('rdLinkCutoff', () => {
	// Sampled 2026-11-06: RD record links 30-120 days old played as often as fresh ones
	// (15/16 against 14/16), while past 120 days none did (name-blocked or gone). The 30-day
	// window hid 87% of DMM's RD record from Cast for no measured reason.
	it('offers RD links up to 120 days old, the age they were measured to keep playing', () => {
		for (const band of ['0-7', '7-30', '30-60', '60-120']) {
			expect(playRate('rd', band)).toBeGreaterThanOrEqual(7 / 8);
		}
		expect(playRate('rd', '120-365')).toBe(0);
		expect(RD_LINK_MAX_AGE_MS).toBe(120 * DAY);
		expect(Date.now() - rdLinkCutoff().getTime()).toBeCloseTo(RD_LINK_MAX_AGE_MS, -3);
	});
});

describe('cachedRecordCutoff', () => {
	// AllDebrid's older links were patchy in the same sample (10/16 for 30-120 days against
	// 15/16 inside 30), so AllDebrid and Debrid-Link keep the 30-day window.
	it('keeps AllDebrid and Debrid-Link records to 30 days', () => {
		expect(playRate('ad', '30-60') + playRate('ad', '60-120')).toBeLessThan(2 * (7 / 8));
		expect(CACHED_RECORD_MAX_AGE_MS).toBe(30 * DAY);
		expect(Date.now() - cachedRecordCutoff().getTime()).toBeCloseTo(
			CACHED_RECORD_MAX_AGE_MS,
			-3
		);
	});
});
