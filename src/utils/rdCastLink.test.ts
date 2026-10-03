import { describe, expect, it } from 'vitest';
import { isRdLinkId, rdCastPlayId } from './rdCastLink';

describe('rdCastPlayId', () => {
	it('takes the id off a stored Real-Debrid link, in either length', () => {
		expect(rdCastPlayId('https://real-debrid.com/d/FIXTURELINK00001')).toBe('FIXTURELINK00001');
		expect(rdCastPlayId('https://real-debrid.com/d/FIXTURELINK00')).toBe('FIXTURELINK00');
	});

	it('has nothing for a Debridio availability marker', () => {
		expect(rdCastPlayId('debridio:d836f3e53f48e76d54541931934ff9693e83f686')).toBeNull();
	});

	it('has nothing for a missing link or another host', () => {
		expect(rdCastPlayId(null)).toBeNull();
		expect(rdCastPlayId(undefined)).toBeNull();
		expect(rdCastPlayId('https://app.real-debrid.com/d/FIXTURELINK00001')).toBeNull();
	});
});

describe('isRdLinkId', () => {
	it('accepts the 13-character content key with or without the account tag', () => {
		expect(isRdLinkId('FIXTURELINK00')).toBe(true);
		expect(isRdLinkId('FIXTURELINK00001')).toBe(true);
	});

	it('refuses what the stream route used to cut out of a Debridio marker', () => {
		expect(isRdLinkId('debridio:d836f3e53f48e76d54541931934ff9693e83f686'.substring(26))).toBe(
			false
		);
	});

	it('refuses ids too short to be one, or carrying anything but letters and digits', () => {
		expect(isRdLinkId('')).toBe(false);
		expect(isRdLinkId('FIXTU')).toBe(false);
		expect(isRdLinkId('FIXTURELINK0')).toBe(false);
		expect(isRdLinkId('FIXTURELINK00001X')).toBe(false);
		expect(isRdLinkId('FIXTURE%2FLINK0')).toBe(false);
	});
});
