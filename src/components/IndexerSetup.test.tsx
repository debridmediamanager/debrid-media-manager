import { maskApiKey } from '@/components/IndexerSetup';
import { describe, expect, it } from 'vitest';

describe('maskApiKey', () => {
	it('keeps enough of a real key to recognise which one it is', () => {
		const key = 'a1b2c3' + 'd'.repeat(54) + 'ef12';
		expect(maskApiKey(key)).toBe('a1b2c3••••••••ef12');
	});

	it('never leaks more than it hides on a short value', () => {
		// A gatekeeper key is 64 characters, so this only guards against a
		// truncated or hand-edited storage entry — where showing six of eight
		// characters would be the whole thing.
		expect(maskApiKey('short')).toBe('•••••');
		expect(maskApiKey('exactlytwelv')).toBe('•'.repeat(12));
	});

	it('handles an empty value without throwing', () => {
		expect(maskApiKey('')).toBe('');
	});
});
