import { describe, expect, it } from 'vitest';
import { hasAvailabilityToken, toggleAvailabilityToken } from './availabilityTokens';

describe('hasAvailabilityToken', () => {
	it('matches whole terms only', () => {
		expect(hasAvailabilityToken('1080p is:rd', 'is:rd')).toBe(true);
		expect(hasAvailabilityToken('1080p -is:rd', 'is:rd')).toBe(false);
		expect(hasAvailabilityToken('', 'is:rd')).toBe(false);
	});
});

describe('toggleAvailabilityToken', () => {
	it('appends the token to an existing query', () => {
		expect(toggleAvailabilityToken('matrix 1080p', 'is:rd')).toBe('matrix 1080p is:rd');
		expect(toggleAvailabilityToken('', 'is:rd')).toBe('is:rd');
	});

	it('removes the token when it is already active', () => {
		expect(toggleAvailabilityToken('matrix is:rd', 'is:rd')).toBe('matrix');
		expect(toggleAvailabilityToken('is:rd', 'is:rd')).toBe('');
	});

	it('keeps availability tokens mutually exclusive', () => {
		expect(toggleAvailabilityToken('matrix is:rd', 'is:tb')).toBe('matrix is:tb');
		expect(toggleAvailabilityToken('is:cached 1080p', 'is:ad')).toBe('1080p is:ad');
	});

	it('leaves other query terms untouched', () => {
		expect(toggleAvailabilityToken('videos:>3 -cam is:rd', 'is:cached')).toBe(
			'videos:>3 -cam is:cached'
		);
	});
});
