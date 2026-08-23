import { describe, expect, it } from 'vitest';
import { deInfringe, isRdBlockedName } from './deInfringe';

describe('isRdBlockedName', () => {
	// Names RD refuses on the first request, every time.
	it.each([
		'Show.S01E01.1080p.WEB-DL.DDP5.1.H.265-NTb',
		'Show.S01E01.1080p.WEBRip.x265-RARBG',
		'Movie.2019.720p.BDRip.x264-GROUP',
		'Movie.2019.720p.HDRip.XviD-GROUP',
		'Movie.1999.DVDRip.XviD-GROUP',
		'Movie.2015.1080p.BluRay.x264-GROUP',
		'Show.S01E01.720p.HDTV.x264-GROUP',
		'Show.S01E01.HDTV.XviD-AFG',
		'Show.S01E01.1080p.WEB.x264-GROUP',
		'Show.S01E01.1080p.WEB.h264-GROUP',
	])('flags %s', (name) => {
		expect(isRdBlockedName(name)).toBe(true);
	});

	// Names RD accepts. Each separator variant matters: RD keys on the exact
	// substring, so `WEB.DL` passing while `WEB-DL` is refused is the whole
	// reason `deInfringe`'s rewrite works.
	it.each([
		'Show.S01E01.1080p.WEB.DL.DDP5.1.H.265-NTb',
		'Show.S01E01.1080p.WEBDL.H265-NTb',
		'Show.S01E01.1080p.WEB-Rip.x265-GROUP',
		'Movie.2015.1080p.BluRay-x264-GROUP',
		'Movie.2015.1080p.Blu-Ray.x264-GROUP',
		'Movie.2015.1080p.BluRay.x265-GROUP',
		'Show.S01E01.1080p.WEB.x265-GROUP',
		'Show.S01E01.1080p.HEVC.x265-MeGusta',
		'Show.S01E01.480p.x264-mSD',
		'Show.S01E01.XviD-AFG',
	])('passes %s', (name) => {
		expect(isRdBlockedName(name)).toBe(false);
	});

	// Measured 2026-08-23: RD downloaded both `HDTV.H264-FTP` releases of
	// Would.I.Lie.To.You.S19E10 to 100%, so this pair is not on its blocklist —
	// even though `deInfringe` rewrites it. Gating a deletion on `deInfringe`
	// would have evicted two working availability rows.
	it('does not flag HDTV.H264, which deInfringe still rewrites', () => {
		const name = 'Would.I.Lie.To.You.S19E10.1080p.HDTV.H264-FTP';
		expect(isRdBlockedName(name)).toBe(false);
		expect(deInfringe(name)).not.toBe(name);
	});

	it('matches case-insensitively and mid-name', () => {
		expect(isRdBlockedName('pack/Movie.2019.1080p.web-dl.x265/file.mkv')).toBe(true);
		expect(isRdBlockedName('')).toBe(false);
	});
});

describe('deInfringe', () => {
	it('breaks every blocked pattern it rewrites', () => {
		const rewritten = [
			'Show.S01E01.1080p.WEB-DL.H265',
			'Show.S01E01.1080p.WEBRip.x265',
			'Movie.720p.BDRip.x264',
			'Movie.720p.HDRip.XviD',
			'Movie.DVDRip.XviD',
			'Movie.1080p.BluRay.x264',
			'Show.720p.HDTV.x264',
			'Show.HDTV.XviD',
			'Show.1080p.WEB.x264',
			'Show.1080p.WEB.h264',
		].map(deInfringe);
		for (const name of rewritten) {
			expect(isRdBlockedName(name)).toBe(false);
		}
	});

	it('leaves names RD accepts alone', () => {
		for (const name of [
			'Movie.2015.1080p.BluRay.x265-GROUP',
			'Show.S01E01.1080p.WEB.x265-GROUP',
			'Show.S01E01.480p.x264-mSD',
		]) {
			expect(deInfringe(name)).toBe(name);
		}
	});
});
