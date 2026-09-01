import { describe, expect, it } from 'vitest';
import {
	isWebDownloadHash,
	isWebDownloadRowId,
	parseTorBoxCastTarget,
	parseTorBoxRowId,
	toWebDownloadRowId,
} from './torboxWebDownload';

describe('torboxWebDownload helpers', () => {
	it('builds and recognises web download row ids', () => {
		expect(toWebDownloadRowId(123)).toBe('tb:w123');
		expect(isWebDownloadRowId('tb:w123')).toBe(true);
		expect(isWebDownloadRowId('tb:123')).toBe(false);
		expect(isWebDownloadRowId('rd:123')).toBe(false);
	});

	it('keeps web download row ids inside the TorBox namespace', () => {
		// Every `startsWith('tb:')` branch in the library must still see these
		expect(toWebDownloadRowId(9).startsWith('tb:')).toBe(true);
	});

	it('parses the numeric id out of either TorBox row id form', () => {
		expect(parseTorBoxRowId('tb:456')).toBe(456);
		expect(parseTorBoxRowId('tb:w456')).toBe(456);
	});

	it('parses cast path segments', () => {
		expect(parseTorBoxCastTarget('456')).toEqual({
			id: 456,
			kind: 'torrent',
			isWebDownload: false,
		});
		expect(parseTorBoxCastTarget('w456')).toEqual({
			id: 456,
			kind: 'webdl',
			isWebDownload: true,
		});
		expect(parseTorBoxCastTarget('abc')).toBeNull();
		expect(parseTorBoxCastTarget('w')).toBeNull();
	});

	it('tells md5 web download hashes from sha1 infohashes', () => {
		expect(isWebDownloadHash('a'.repeat(32))).toBe(true);
		expect(isWebDownloadHash('A'.repeat(32))).toBe(true);
		expect(isWebDownloadHash('a'.repeat(40))).toBe(false);
		expect(isWebDownloadHash('z'.repeat(32))).toBe(false);
		expect(isWebDownloadHash('')).toBe(false);
	});
});

describe('parseTorBoxCastTarget kinds', () => {
	// TorBox keeps torrents, web downloads and usenet downloads in three tables
	// whose numeric ids overlap. Only the prefix says which table to look in.
	it.each([
		['123', 'torrent', 123],
		['w1599037', 'webdl', 1599037],
		['u2367148', 'usenet', 2367148],
	])('reads %s as a %s id', (idPart, kind, id) => {
		expect(parseTorBoxCastTarget(idPart)).toEqual({
			id,
			kind,
			isWebDownload: kind === 'webdl',
		});
	});

	it.each(['abc', 'w', 'u', '', 'wabc'])('rejects %s', (idPart) => {
		expect(parseTorBoxCastTarget(idPart)).toBeNull();
	});
});
