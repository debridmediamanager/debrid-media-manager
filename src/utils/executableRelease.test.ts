import { describe, expect, it } from 'vitest';
import { isExecutableRelease } from './executableRelease';

describe('isExecutableRelease', () => {
	it.each([
		// names read from DMM's pages on 2026-11-07
		[{ title: 'Ted Lasso S04E04 1080p HEVC x265-MeGusta .exe', fileSize: 917.95 }, true],
		[{ title: 'Motor City 2026 1080pHD WEB ENG Multi Subs EZTV exe', fileSize: 1198 }, true],
		[{ title: 'The.Pitt.S01E08.1080p.WEB.H264-SuccessfulCrab.mkv.lnk', fileSize: 927 }, true],
		[{ filename: '[SubsPlease] Hotel Inhumans S2 - 06 (1080p).exe', size_bytes: 869.27 }, true],
		[{ title: 'Hokum 2026 1080p HD X26.exe' }, true], // no size: counts as small
		[{ filename: 'Rockman.EXE', size_bytes: 48718.43 }, false], // the series, a 48 GB pack
		[{ title: 'The Bat', fileSize: 1400 }, false],
		[
			{ title: 'The Odyssey 2026 1080p AMZN WEB-DL DDP5 1 H 264-Kitsune', fileSize: 4454 },
			false,
		],
		[null, false],
	])('%j -> %s', (row, expected) => {
		expect(isExecutableRelease(row)).toBe(expected);
	});
});
