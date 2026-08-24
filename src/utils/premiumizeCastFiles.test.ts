import { describe, expect, it } from 'vitest';
import {
	matchPremiumizeFile,
	premiumizePlaybackUrl,
	premiumizeVideoFiles,
} from './premiumizeCastFiles';

const content = [
	{
		path: 'Big Buck Bunny/poster.jpg',
		size: 310380,
		link: 'https://cdn/poster.jpg',
		stream_link: null,
	},
	{ path: 'Big Buck Bunny/subs.srt', size: 140, link: 'https://cdn/subs.srt', stream_link: null },
	{
		path: 'Big Buck Bunny/Big Buck Bunny.mp4',
		size: 276134947,
		link: 'https://cdn/bbb.mp4',
		stream_link: 'https://cdn/bbb-stream.mp4',
	},
] as any;

describe('premiumizeVideoFiles', () => {
	// directdl's top-level location/filename/filesize mirror content[0], which
	// here is a 310 KB poster rather than the 276 MB video.
	it('keeps only videos and puts the biggest first', () => {
		const files = premiumizeVideoFiles(content);
		expect(files).toHaveLength(1);
		expect(files[0].filename).toBe('Big Buck Bunny.mp4');
	});

	it('treats a missing size as zero rather than breaking the sort', () => {
		const files = premiumizeVideoFiles([
			{ path: 'a.mkv', size: null, link: 'https://cdn/a.mkv', stream_link: null },
			{ path: 'b.mkv', size: 10, link: 'https://cdn/b.mkv', stream_link: null },
		] as any);
		expect(files.map((f) => f.filename)).toEqual(['b.mkv', 'a.mkv']);
	});

	it('drops an entry with no link', () => {
		expect(
			premiumizeVideoFiles([{ path: 'a.mkv', size: 1, link: '', stream_link: null }] as any)
		).toEqual([]);
	});
});

describe('matchPremiumizeFile', () => {
	const files = premiumizeVideoFiles([
		{ path: 'Show/Show.S01E01.mkv', size: 10, link: 'https://cdn/e1', stream_link: null },
		{ path: 'Show/Show.S01E02.mkv', size: 20, link: 'https://cdn/e2', stream_link: null },
	] as any);

	it('matches the stored path', () => {
		expect(matchPremiumizeFile(files, 'Show/Show.S01E01.mkv')?.link).toBe('https://cdn/e1');
	});

	it('falls back to the basename when the parent folder differs', () => {
		expect(matchPremiumizeFile(files, 'Other Folder/Show.S01E01.mkv')?.link).toBe(
			'https://cdn/e1'
		);
	});

	it('takes the biggest file when nothing was stored', () => {
		expect(matchPremiumizeFile(files, null)?.link).toBe('https://cdn/e2');
	});

	it('returns nothing when the file is gone from the release', () => {
		expect(matchPremiumizeFile(files, 'Show.S09E99.mkv')).toBeUndefined();
	});
});

describe('premiumizePlaybackUrl', () => {
	it('prefers the transcoded rendition when Premiumize made one', () => {
		expect(premiumizePlaybackUrl(premiumizeVideoFiles(content)[0])).toBe(
			'https://cdn/bbb-stream.mp4'
		);
	});

	it('falls back to the original, which is always present', () => {
		const [file] = premiumizeVideoFiles([
			{ path: 'a.mkv', size: 1, link: 'https://cdn/a.mkv', stream_link: null },
		] as any);
		expect(premiumizePlaybackUrl(file)).toBe('https://cdn/a.mkv');
	});
});
