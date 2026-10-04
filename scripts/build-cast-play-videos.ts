/**
 * Renders the DMM Cast play notices listed in `src/utils/castPlayVideos.ts`
 * into `public/noprecache/cast-play/`. Run it again after changing their text.
 *
 *   npx tsx scripts/build-cast-play-videos.ts
 *
 * Needs ffmpeg with libx264 and the drawtext filter, and `npm ci`: the font is
 * the Noto Sans (SIL Open Font License) that Next ships for `next/og`.
 *
 * The format follows Torrentio's notice videos, which every Stremio player
 * already plays: H.264 High, yuv420p, 25 fps, with an AAC LC audio track
 * (silent here) because some TV players will not start a file without one.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	CAST_PLAY_VIDEO_DIR,
	CAST_PLAY_VIDEO_SECONDS,
	CAST_PLAY_VIDEOS,
	type CastPlayVideo,
} from '../src/utils/castPlayVideos';

const ROOT = path.resolve(__dirname, '..');
const FONT = path.join(
	ROOT,
	'node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf'
);
const OUT_DIR = path.join(ROOT, 'public', CAST_PLAY_VIDEO_DIR);

const WIDTH = 1280;
const HEIGHT = 720;
const MARGIN = 96;
const FOOTER = 'DMM Cast  ·  debridmediamanager.com';

// drawtext reads each line from a file, so nothing in the text needs escaping
// for the filter graph; `expansion=none` keeps a `%` literal too.
const drawText = (file: string, size: number, color: string, y: number) =>
	`drawtext=fontfile='${FONT}':textfile='${file}':expansion=none:fontsize=${size}:fontcolor=${color}:x=${MARGIN}:y=${y}`;

function render(video: CastPlayVideo, work: string) {
	const { title, lines } = CAST_PLAY_VIDEOS[video];
	const filters: string[] = [];
	const write = (name: string, text: string) => {
		const file = path.join(work, `${video}-${name}.txt`);
		writeFileSync(file, text);
		return file;
	};

	filters.push(drawText(write('title', title), 50, 'white', 170));
	lines.forEach((line, index) => {
		if (line)
			filters.push(drawText(write(`line${index}`, line), 34, '0xd1d5db', 280 + index * 52));
	});
	filters.push(drawText(write('footer', FOOTER), 26, '0x9ca3af', HEIGHT - 90));

	const frame = path.join(work, `${video}.png`);
	execFileSync('ffmpeg', [
		'-v',
		'error',
		'-y',
		'-f',
		'lavfi',
		'-i',
		`color=c=0x111827:s=${WIDTH}x${HEIGHT}`,
		'-vf',
		filters.join(','),
		'-frames:v',
		'1',
		frame,
	]);

	const out = path.join(OUT_DIR, `${video}.mp4`);
	execFileSync('ffmpeg', [
		'-v',
		'error',
		'-y',
		'-loop',
		'1',
		'-framerate',
		'25',
		'-i',
		frame,
		'-f',
		'lavfi',
		'-i',
		'anullsrc=r=44100:cl=stereo',
		'-t',
		String(CAST_PLAY_VIDEO_SECONDS),
		'-map_metadata',
		'-1',
		'-fflags',
		'+bitexact',
		'-flags:v',
		'+bitexact',
		'-flags:a',
		'+bitexact',
		'-c:v',
		'libx264',
		'-profile:v',
		'high',
		'-tune',
		'stillimage',
		'-pix_fmt',
		'yuv420p',
		'-x264-params',
		'keyint=750:min-keyint=750',
		'-crf',
		'28',
		'-c:a',
		'aac',
		'-b:a',
		'16k',
		'-movflags',
		'+faststart',
		'-shortest',
		out,
	]);
	return out;
}

mkdirSync(OUT_DIR, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'cast-play-'));
try {
	for (const video of Object.keys(CAST_PLAY_VIDEOS) as CastPlayVideo[]) {
		console.log(`rendered ${path.relative(ROOT, render(video, work))}`);
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}
