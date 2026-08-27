import {
	canClaim,
	isClaimable,
	normalizeHash,
	normalizeImdbId,
	normalizeMediaType,
	normalizeTitle,
	parseRequestInput,
	pickSourceKeys,
	RequestValidationError,
	toPublicRequest,
} from '@/utils/contentRequest';
import { describe, expect, it } from 'vitest';

const HASH = '1ea32261cd04fc8633c6b30ca3d98213279d689f';

describe('normalizeHash', () => {
	it('accepts a 40-character hash', () => {
		expect(normalizeHash(HASH)).toBe(HASH);
	});

	// Two casings of one release would otherwise be two rows that nothing can
	// reconcile, which defeats the unique constraint entirely.
	it('lowercases so one release is one row', () => {
		expect(normalizeHash(HASH.toUpperCase())).toBe(HASH);
	});

	it('trims surrounding whitespace', () => {
		expect(normalizeHash(`  ${HASH}  `)).toBe(HASH);
	});

	it.each([
		['too short', HASH.slice(0, 39)],
		['too long', `${HASH}a`],
		['not hex', `${HASH.slice(0, 39)}z`],
		['a magnet uri', `magnet:?xt=urn:btih:${HASH}`],
		['empty', ''],
	])('rejects %s', (_label, raw) => {
		expect(() => normalizeHash(raw)).toThrow(RequestValidationError);
	});

	it.each([null, undefined, 42, {}])('rejects the non-string %p', (raw) => {
		expect(() => normalizeHash(raw)).toThrow('hash is required');
	});
});

describe('normalizeImdbId', () => {
	it.each(['tt1234567', 'tt40247521', 'TT1234567', '  tt1234567 '])('accepts %s', (raw) => {
		expect(normalizeImdbId(raw)).toBe(raw.trim().toLowerCase());
	});

	it.each(['1234567', 'tt123', 'ttabcdefg', '', 'tt12345678901'])('rejects %s', (raw) => {
		expect(() => normalizeImdbId(raw)).toThrow(RequestValidationError);
	});

	it('rejects a non-string', () => {
		expect(() => normalizeImdbId(null)).toThrow('imdbId is required');
	});
});

describe('normalizeMediaType', () => {
	it.each(['movie', 'show', 'MOVIE', ' show '])('accepts %s', (raw) => {
		expect(normalizeMediaType(raw)).toBe(raw.trim().toLowerCase());
	});

	it.each(['anime', 'tv', '', null, 7])('rejects %p', (raw) => {
		expect(() => normalizeMediaType(raw)).toThrow('mediaType must be one of');
	});
});

describe('normalizeTitle', () => {
	it('collapses runs of whitespace', () => {
		expect(normalizeTitle('  The   Big    Lebowski ')).toBe('The Big Lebowski');
	});

	it.each([null, undefined, '', '   ', 5])('treats %p as absent', (raw) => {
		expect(normalizeTitle(raw)).toBeNull();
	});

	it('caps an absurd title', () => {
		expect(normalizeTitle('x'.repeat(900))).toHaveLength(500);
	});
});

describe('parseRequestInput', () => {
	it('normalises a whole body', () => {
		expect(
			parseRequestInput({
				hash: HASH.toUpperCase(),
				imdbId: 'TT1234567',
				title: '  Some   Release ',
				mediaType: 'Movie',
			})
		).toEqual({ hash: HASH, imdbId: 'tt1234567', title: 'Some Release', mediaType: 'movie' });
	});

	it('accepts a body with no title', () => {
		const parsed = parseRequestInput({ hash: HASH, imdbId: 'tt1234567', mediaType: 'show' });
		expect(parsed.title).toBeNull();
	});

	it.each([undefined, null, {}, 'nonsense'])('rejects the unusable body %p', (body) => {
		expect(() => parseRequestInput(body)).toThrow(RequestValidationError);
	});
});

describe('isClaimable', () => {
	it.each(['open', 'failed'])('%s can be taken', (status) => {
		expect(isClaimable(status)).toBe(true);
	});

	// A second fulfiller arriving mid-transfer would spend their own TorBox
	// quota re-fetching something already on its way.
	it.each(['claimed', 'fulfilled', 'cancelled', 'nonsense'])('%s cannot', (status) => {
		expect(isClaimable(status)).toBe(false);
	});
});

describe('canClaim', () => {
	it('lets a different user take an open request', () => {
		expect(canClaim({ status: 'open', requesterId: 'asker' }, 'helper')).toEqual({ ok: true });
	});

	it('lets a different user retry a failed one', () => {
		expect(canClaim({ status: 'failed', requesterId: 'asker' }, 'helper').ok).toBe(true);
	});

	it('refuses one already in flight, with a conflict', () => {
		expect(canClaim({ status: 'claimed', requesterId: 'asker' }, 'helper')).toEqual({
			ok: false,
			code: 409,
			reason: 'request is claimed',
		});
	});

	// Someone holding both halves never needed the board.
	it('refuses self-fulfilment', () => {
		const verdict = canClaim({ status: 'open', requesterId: 'asker' }, 'asker');
		expect(verdict).toMatchObject({ ok: false, code: 400 });
	});

	it('checks the status before self-fulfilment, so the clearer reason wins', () => {
		expect(canClaim({ status: 'fulfilled', requesterId: 'asker' }, 'asker')).toMatchObject({
			code: 409,
		});
	});
});

describe('pickSourceKeys', () => {
	it('passes a TorBox key through', () => {
		expect(pickSourceKeys({ torboxApiKey: 'TB' })).toEqual({ tb_api_key: 'TB' });
	});

	it('passes an AllDebrid key through', () => {
		expect(pickSourceKeys({ alldebridApiKey: 'AD' })).toEqual({ ad_api_key: 'AD' });
	});

	it('passes both when the fulfiller has both', () => {
		expect(pickSourceKeys({ torboxApiKey: 'TB', alldebridApiKey: 'AD' })).toEqual({
			tb_api_key: 'TB',
			ad_api_key: 'AD',
		});
	});

	it('trims', () => {
		expect(pickSourceKeys({ torboxApiKey: '  TB  ' })).toEqual({ tb_api_key: 'TB' });
	});

	// Mirrors the uploader's own refusal, so this fails as a 400 rather than as
	// a job that dies the moment it arrives.
	it.each([{}, { torboxApiKey: '' }, { torboxApiKey: '   ', alldebridApiKey: null }])(
		'refuses %p, which carries no cache source',
		(keys) => {
			expect(() => pickSourceKeys(keys)).toThrow('TorBox or AllDebrid key is required');
		}
	);
});

describe('toPublicRequest', () => {
	const row = {
		id: 'r1',
		hash: HASH,
		imdbId: 'tt1234567',
		title: 'Some Release',
		mediaType: 'movie',
		status: 'open',
		requesterId: 'asker',
		fulfillerId: 'helper',
		jobId: 'job-1',
		createdAt: new Date('2026-08-27T05:00:00Z'),
	};

	// Both ids are stable HMACs of a Real-Debrid username. Publishing them would
	// let anyone watching the board follow one person across every release.
	it('never leaks either participant id', () => {
		const serialised = JSON.stringify(toPublicRequest(row, null));
		expect(serialised).not.toContain('asker');
		expect(serialised).not.toContain('helper');
	});

	it('marks the caller their own rows', () => {
		expect(toPublicRequest(row, 'asker').mine).toBe(true);
		expect(toPublicRequest(row, 'helper').mine).toBe(false);
		expect(toPublicRequest(row, null).mine).toBe(false);
	});

	it('exposes the job so the asker can follow the transfer', () => {
		expect(toPublicRequest(row, 'asker').jobId).toBe('job-1');
	});

	it('serialises the timestamp as ISO', () => {
		expect(toPublicRequest(row, null).createdAt).toBe('2026-08-27T05:00:00.000Z');
	});

	it('accepts a string timestamp from a raw driver row', () => {
		expect(toPublicRequest({ ...row, createdAt: '2026-08-27T05:00:00Z' }, null).createdAt).toBe(
			'2026-08-27T05:00:00.000Z'
		);
	});
});
