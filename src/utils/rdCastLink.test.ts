import { describe, expect, it } from 'vitest';
import { isRdLinkId, rdCastPlayId } from './rdCastLink';

describe('rdCastPlayId', () => {
	it.each(['FIXTURELINK00', 'FIXTURELINK00ABC', 'FIXTURELINK00ABCDEFGHIJKLM'])(
		'normalizes the stored RD id %s to its 13-character content key',
		(id) => {
			expect(rdCastPlayId(`https://real-debrid.com/d/${id}`)).toBe('FIXTURELINK00');
		}
	);

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

	it('accepts a historical 26-character account-bound id', () => {
		expect(isRdLinkId('FIXTURELINK00ABCDEFGHIJKLM')).toBe(true);
	});

	it('refuses ids too short to be one, or carrying anything but letters and digits', () => {
		expect(isRdLinkId('')).toBe(false);
		expect(isRdLinkId('FIXTU')).toBe(false);
		expect(isRdLinkId('FIXTURELINK0')).toBe(false);
		expect(isRdLinkId('FIXTURE%2FLINK0')).toBe(false);
	});
});
