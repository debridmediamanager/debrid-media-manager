import { afterEach, describe, expect, it, vi } from 'vitest';
import { castSalt } from './castSalt';

describe('castSalt', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('returns a configured salt', () => {
		vi.stubEnv('DMMCAST_SALT', 'a-real-salt');
		expect(castSalt()).toBe('a-real-salt');
	});

	it('refuses an unset salt', () => {
		vi.stubEnv('DMMCAST_SALT', '');
		expect(() => castSalt()).toThrow('DMMCAST_SALT environment variable is not set');
	});

	it('refuses the public .env.example placeholder', () => {
		vi.stubEnv('DMMCAST_SALT', 'your-random-salt-here');
		expect(() => castSalt()).toThrow(/placeholder/);
	});
});
