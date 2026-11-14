import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOfficialDmm } from './officialDmm';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('isOfficialDmm', () => {
	it('is false in a browser on any other host', () => {
		expect(window.location.hostname).toBe('localhost');
		expect(isOfficialDmm()).toBe(false);
	});

	it.each([
		['https://debridmediamanager.com', true],
		['https://www.debridmediamanager.com/', true],
		['http://localhost:3000', false],
		['https://debridmediamanager.com.evil.example', false],
		['https://notdebridmediamanager.com', false],
		['', false],
	])('on the server, DMM_ORIGIN %j gives %s', (origin, official) => {
		vi.stubGlobal('window', undefined);
		vi.stubEnv('DMM_ORIGIN', origin);
		expect(isOfficialDmm()).toBe(official);
	});
});
