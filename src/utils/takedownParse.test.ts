import { describe, expect, it } from 'vitest';
import { base32ToHex, normalizeReleaseName, parseNoticeLocations } from './takedownParse';

// Big Buck Bunny's infohash. The base32 form is Python's
// base64.b32encode of the same 20 bytes, not our own converter's output.
const BBB_HEX = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const BBB_BASE32 = '3WBFL3G4PSSV7MF37AJSHWDQMLNR63I4';

describe('parseNoticeLocations', () => {
	it('reads hex hashes wherever they sit in the text', () => {
		const { hashes } = parseNoticeLocations(
			`1. magnet:?xt=urn:btih:${BBB_HEX.toUpperCase()}&dn=x\n2) ${'a'.repeat(40)}, and more`,
			''
		);
		expect(hashes).toEqual([BBB_HEX, 'a'.repeat(40)]);
	});

	it('converts a base32 magnet hash to hex', () => {
		expect(base32ToHex(BBB_BASE32)).toBe(BBB_HEX);
		const { hashes } = parseNoticeLocations(`magnet:?xt=urn:btih:${BBB_BASE32}&dn=bbb`, '');
		expect(hashes).toEqual([BBB_HEX]);
	});

	// A SHA-256 in a notice would otherwise block whatever torrent happens to
	// share its first forty characters.
	it('does not cut a hash out of a longer hex run', () => {
		const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
		expect(parseNoticeLocations(sha256, '').hashes).toEqual([]);
	});

	it('reads share page ids from hash list URLs', () => {
		const id = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
		const { hashlistIds } = parseNoticeLocations(
			`https://hashlists.debridmediamanager.com/${id}.html`,
			''
		);
		expect(hashlistIds).toEqual([id]);
	});

	it('normalizes release names and ignores bare words', () => {
		const { releases } = parseNoticeLocations(
			'',
			'Big Buck Bunny 2008 1080p BluRay x264-GROUP.nzb\nmovie\n  \n'
		);
		expect(releases).toEqual(['big.buck.bunny.2008.1080p.bluray.x264.group']);
	});

	it('dedupes', () => {
		const { hashes } = parseNoticeLocations(`${BBB_HEX} ${BBB_HEX.toUpperCase()}`, '');
		expect(hashes).toEqual([BBB_HEX]);
	});
});

describe('normalizeReleaseName', () => {
	// The uploaders implement the same rule; these pin the shared contract.
	it.each([
		[
			'Big.Buck.Bunny.2008.1080p.BluRay.x264-GROUP',
			'big.buck.bunny.2008.1080p.bluray.x264.group',
		],
		['  Tears of Steel (2012) [4K].nzb', 'tears.of.steel.2012.4k'],
		['...a__b...', 'a.b'],
	])('%s', (input, expected) => {
		expect(normalizeReleaseName(input)).toBe(expected);
	});
});
