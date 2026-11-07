import odyssey from '@/test/fixtures/aiostreams/odyssey-2026-11-07.json';
import { meetsTitleConditions } from '@/utils/checks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aioStreamHash, aioStreamsBase, parseAioStreams } from './aiostreams';

const odysseyTitle = (release: { title: string }) =>
	meetsTitleConditions('The Odyssey', ['2026'], release.title);
const byHash = (hash: string) =>
	parseAioStreams(odyssey, odysseyTitle).torrents.find((t) => t.hash === hash);
const titles = () => parseAioStreams(odyssey, odysseyTitle).torrents.map((t) => t.title);

describe('parseAioStreams on the real answer for The Odyssey (2026)', () => {
	it('takes the 80+ GB remuxes DMM Cast TB was missing', () => {
		// Cached on TorBox on 2026-11-07 and in none of DMM's sources.
		for (const hash of [
			'601aff1ef7c1d7023a61ba49d283bc74728ad3f6',
			'31accef5eda5c473f5c22f1d6f1d9be7a98d8efb',
			'e6eba29dfb6e11190212e055eac1869c28ef048e',
			'864a36e5254aeb0db48e9c5ea45e3268c49d115f',
		]) {
			expect(byHash(hash), hash).toBeDefined();
		}
		expect(byHash('601aff1ef7c1d7023a61ba49d283bc74728ad3f6')).toEqual({
			hash: '601aff1ef7c1d7023a61ba49d283bc74728ad3f6',
			title: 'The.Odyssey.2026.2160p.USA.UHD.Blu-ray.HDR.HEVC.DTS-HD.MA.5.1-TMT',
			fileSize: Number((96913653996 / 1024 / 1024).toFixed(2)),
		});
	});

	it('reads the hash wherever the source put it', () => {
		const shapes: Record<string, string> = {
			torrentio: 'ace6ee112446904ea51a44756caa819153ae242f', // resolve path segment
			peerflix: '7465986e6ac5c60dd72e940854ff66401795be36', // path segment
			mediafusion: 'd730eb10bb6d4e2bcfa0ff86a39c832284a8c707', // last path segment
			bitmagnet: 'd3d45212f2726bd99d0ba10afe6818b199b03b75', // base64 JSON segment
			sootio: '832e44125cd1b845a90536a913d94ec9d93aa735', // URL-encoded magnet
		};
		for (const [source, hash] of Object.entries(shapes)) {
			const stream = odyssey.streams.find(
				(s) => s.name === source && aioStreamHash(s as Record<string, unknown>) === hash
			);
			expect(stream, source).toBeDefined();
		}
	});

	it('files a release seen twice, with and without infoHash, once', () => {
		const tmt = parseAioStreams(odyssey, odysseyTitle).torrents.filter(
			(t) => t.hash === '601aff1ef7c1d7023a61ba49d283bc74728ad3f6'
		);
		expect(tmt).toHaveLength(1);
	});

	it('drops error rows and rate-limit notices', () => {
		expect(titles().some((t) => /error|Too many requests|Unexpected token/i.test(t))).toBe(
			false
		);
	});

	it('asks name-searched sources the check, never id-keyed ones', () => {
		expect(titles()).toContain('The.Odyssey.2026.1080p.WEBRip.x265-INFINITY.mp4');
		expect(titles()).not.toContain('[2026.08.21] VA - Pure Space Odyssey, Vol. 1');
	});

	it('keeps an id-keyed source as it is, title check or not', () => {
		const rejectAll = parseAioStreams(odyssey, () => false).torrents;
		expect(rejectAll.map((t) => t.hash)).toContain('601aff1ef7c1d7023a61ba49d283bc74728ad3f6');
		expect(rejectAll.some((t) => t.title.includes('INFINITY'))).toBe(false);
	});
});

describe('aioStreamsBase', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('is off unless configured', () => {
		vi.stubEnv('AIOSTREAMS_URL', '');
		expect(aioStreamsBase()).toBeNull();
	});

	it('accepts a manifest paste and trims it to the addon base', () => {
		vi.stubEnv('AIOSTREAMS_URL', 'https://aio.example/stremio/u/p/manifest.json');
		expect(aioStreamsBase()).toBe('https://aio.example/stremio/u/p');
	});

	it('refuses plain http', () => {
		vi.stubEnv('AIOSTREAMS_URL', 'http://aio.example/stremio/u/p');
		expect(aioStreamsBase()).toBeNull();
	});
});
