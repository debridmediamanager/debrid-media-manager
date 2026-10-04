// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	CAST_PLAY_VIDEO_DIR,
	CAST_PLAY_VIDEO_SECONDS,
	CAST_PLAY_VIDEOS,
	type CastPlayVideo,
	castPlayVideoUrl,
} from './castPlayVideos';

type Box = { type: string; start: number; end: number };

/** The boxes directly inside `buffer[start, end)`. */
const boxesIn = (buffer: Buffer, start: number, end: number): Box[] => {
	const boxes: Box[] = [];
	let offset = start;
	while (offset + 8 <= end) {
		const size = buffer.readUInt32BE(offset);
		const type = buffer.toString('latin1', offset + 4, offset + 8);
		if (size < 8) break;
		boxes.push({ type, start: offset, end: offset + size });
		offset += size;
	}
	return boxes;
};

/** Duration in seconds from the movie header. */
const durationOf = (buffer: Buffer, moov: Box): number => {
	const mvhd = boxesIn(buffer, moov.start + 8, moov.end).find((box) => box.type === 'mvhd')!;
	const body = mvhd.start + 8;
	const version = buffer.readUInt8(body);
	if (version === 1) {
		const timescale = buffer.readUInt32BE(body + 20);
		return Number(buffer.readBigUInt64BE(body + 24)) / timescale;
	}
	const timescale = buffer.readUInt32BE(body + 12);
	return buffer.readUInt32BE(body + 16) / timescale;
};

const videos = Object.keys(CAST_PLAY_VIDEOS) as CastPlayVideo[];

describe('DMM Cast play notice videos', () => {
	// next-pwa precaches every file in public/ outside noprecache/, so a video
	// anywhere else would be downloaded by every visitor's service worker.
	it('live outside the service worker precache', () => {
		expect(CAST_PLAY_VIDEO_DIR.startsWith('noprecache/')).toBe(true);
	});

	it.each(videos)('%s is a faststart MP4 that runs the declared length', (video) => {
		const buffer = readFileSync(
			path.join(process.cwd(), 'public', CAST_PLAY_VIDEO_DIR, `${video}.mp4`)
		);
		const top = boxesIn(buffer, 0, buffer.length);
		const types = top.map((box) => box.type);

		expect(types[0]).toBe('ftyp');
		// A player streams it from the first byte, so the index comes first.
		expect(types.indexOf('moov')).toBeGreaterThan(-1);
		expect(types.indexOf('moov')).toBeLessThan(types.indexOf('mdat'));
		// Long enough that reading it never crosses Stremio's 70% watched mark.
		expect(durationOf(buffer, top.find((box) => box.type === 'moov')!)).toBeCloseTo(
			CAST_PLAY_VIDEO_SECONDS,
			0
		);
		expect(buffer.length).toBeLessThan(1024 * 1024);
	});

	it('are addressed on the public origin', () => {
		expect(castPlayVideoUrl('file-unavailable')).toBe(
			'https://debridmediamanager.com/noprecache/cast-play/file-unavailable.mp4'
		);
	});
});
