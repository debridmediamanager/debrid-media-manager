import { cleanNamesFirst } from '@/services/newznab/order';
import { describe, expect, it } from 'vitest';

const titles = (list: string[]) =>
	cleanNamesFirst(list.map((title) => ({ title }))).map((r) => r.title);

describe('cleanNamesFirst', () => {
	it('puts clean names first, then reposts, then raw subject lines', () => {
		expect(
			titles([
				'[01/48] - "Some.Movie.2026.1080p.BluRay.x265-GRP.mkv.par2"',
				'Some.Movie.2026.2160p.WEB-DL.DDP5.1.H.265-GRP-FTP',
				'Some.Movie.2026.2160p.WEB-DL.DDP5.1.H.265-GRP',
				'(Some Movie 2026 1080p h265) [05/38] - "Some Movie 2026 1080p h265.part04.rar"',
				'Some.Movie.2026.1080p.BluRay.x264-OTHER-AsRequested',
				'[2/8] "Some.Movie.(2026).VFF.2160p..EAC3.5.1.HEVC-GRP.rar"',
				'Some.Movie.2026.1080p.BluRay.x264-OTHER',
			])
		).toEqual([
			'Some.Movie.2026.2160p.WEB-DL.DDP5.1.H.265-GRP',
			'Some.Movie.2026.1080p.BluRay.x264-OTHER',
			'Some.Movie.2026.2160p.WEB-DL.DDP5.1.H.265-GRP-FTP',
			'Some.Movie.2026.1080p.BluRay.x264-OTHER-AsRequested',
			'[01/48] - "Some.Movie.2026.1080p.BluRay.x265-GRP.mkv.par2"',
			'(Some Movie 2026 1080p h265) [05/38] - "Some Movie 2026 1080p h265.part04.rar"',
			'[2/8] "Some.Movie.(2026).VFF.2160p..EAC3.5.1.HEVC-GRP.rar"',
		]);
	});

	it('keeps the incoming order inside each group', () => {
		const clean = ['C.2026.720p-GRP', 'A.2026.2160p-GRP', 'B.2026.1080p-GRP'];
		const raw = ['[3/9] "Z.rar"', '[1/9] "Y.rar"'];
		expect(titles([raw[0], clean[0], raw[1], clean[1], clean[2]])).toEqual([...clean, ...raw]);
	});

	it('leaves a suffixed title among clean names when its original is not in the set', () => {
		expect(
			titles([
				'Other.Movie.2026.2160p-GRP-xpost-FTP',
				'Some.Movie.2026.1080p-GRP-xpost',
				'Other.Movie.2026.2160p-GRP',
			])
		).toEqual([
			'Some.Movie.2026.1080p-GRP-xpost',
			'Other.Movie.2026.2160p-GRP',
			'Other.Movie.2026.2160p-GRP-xpost-FTP',
		]);
	});
});
