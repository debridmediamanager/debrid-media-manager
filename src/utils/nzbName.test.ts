import { describe, expect, it } from 'vitest';
import { safeNzbName } from './nzbName';

describe('safeNzbName', () => {
	it('adds the extension a release title has no reason to carry', () => {
		expect(safeNzbName('My.Release.1080p')).toBe('My.Release.1080p.nzb');
	});

	it('leaves an existing extension alone, whatever its case', () => {
		expect(safeNzbName('My.Release.NZB')).toBe('My.Release.NZB');
	});

	it('drops the characters Windows and the filesystem reject', () => {
		expect(safeNzbName('A/B\\C:D*E?F"G<H>I|J')).toBe('ABCDEFGHIJ.nzb');
	});

	it('falls back to a name rather than producing a bare extension', () => {
		expect(safeNzbName('   ')).toBe('release.nzb');
		expect(safeNzbName('')).toBe('release.nzb');
	});

	it('caps the length before the extension is added', () => {
		expect(safeNzbName('x'.repeat(300))).toBe(`${'x'.repeat(200)}.nzb`);
	});
});
