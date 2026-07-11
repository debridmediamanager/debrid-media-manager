import { describe, expect, it } from 'vitest';
import { packTorrinToken, splitTorrinToken } from './torrinToken';

describe('torrinToken', () => {
	it('packs baseUrl and apiKey into a single token', () => {
		expect(packTorrinToken('https://tr.test', 'key-123')).toBe('https://tr.test key-123');
	});

	it('splits a packed token back into parts', () => {
		expect(splitTorrinToken('https://tr.test key-123')).toEqual({
			baseUrl: 'https://tr.test',
			apiKey: 'key-123',
		});
	});

	it('round-trips', () => {
		const packed = packTorrinToken('https://my.instance:8080', 'abc');
		expect(splitTorrinToken(packed)).toEqual({
			baseUrl: 'https://my.instance:8080',
			apiKey: 'abc',
		});
	});

	it('only splits on the first separator (apiKey may contain spaces)', () => {
		expect(splitTorrinToken('https://tr.test key with spaces')).toEqual({
			baseUrl: 'https://tr.test',
			apiKey: 'key with spaces',
		});
	});

	it('treats a token with no separator as apiKey-only', () => {
		expect(splitTorrinToken('justapikey')).toEqual({ baseUrl: '', apiKey: 'justapikey' });
	});
});
