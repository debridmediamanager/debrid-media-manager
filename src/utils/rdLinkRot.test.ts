import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { isDeadRdLink, RD_LINK_MAX_AGE_MS, rdErrorOf, rdLinkCutoff } from './rdLinkRot';

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

	it('does not treat a server error or a non-Axios failure as dead', () => {
		expect(isDeadRdLink(rdError('internal_error', 500))).toBe(false);
		expect(isDeadRdLink(new Error('socket hang up'))).toBe(false);
		expect(rdErrorOf(new Error('socket hang up'))).toBeNull();
	});
});

describe('rdLinkCutoff', () => {
	it('is 30 days back', () => {
		expect(RD_LINK_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
		expect(Date.now() - rdLinkCutoff().getTime()).toBeCloseTo(RD_LINK_MAX_AGE_MS, -3);
	});
});
