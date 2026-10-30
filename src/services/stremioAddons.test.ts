import peerflixMovie from '@/test/fixtures/stremioAddons/peerflix-movie-tt0133093-2026-10-29.json';
import torrentioMovie from '@/test/fixtures/stremioAddons/torrentio-movie-tt0133093-2026-10-29.json';
import torrentioSeason from '@/test/fixtures/stremioAddons/torrentio-series-tt0903747-1-1-2026-10-29.json';
import { describe, expect, it } from 'vitest';
import { parseAddonStreams } from './stremioAddons';

// Real answers recorded 2026-10-29 from a home IP with the placeholder-key
// path, trimmed to 12 streams marked [RD+] and 8 marked [RD download] each.
describe('parseAddonStreams', () => {
	it('reads a Torrentio film: name, size and hash, and [RD+] alone as held', () => {
		const { torrents, available } = parseAddonStreams(torrentioMovie);

		expect(torrents).toHaveLength(20);
		expect(available).toHaveLength(12);
		expect(torrents[0]).toEqual({
			title: 'The.Matrix.1999.RERIP.2160p.UHD.BluRay.x265.10bit.HDR.TrueHD.7.1.Atmos-IAMABLE',
			fileSize: 35932.16,
			hash: '03dd34fea0ff15a451c1723062a901aa3a0ad458',
		});
		expect(available[0]).toEqual({
			hash: '03dd34fea0ff15a451c1723062a901aa3a0ad458',
			filename: 'The.Matrix.1999.RERIP.2160p.UHD.BluRay.X265-IAMABLE.mkv',
			bytes: Math.round(35.09 * 1024 ** 3),
		});
		const held = new Set(available.map((row) => row.hash));
		const notHeld = torrentioMovie.streams
			.filter((s) => s.name.startsWith('[RD download]'))
			.map((s) => /\/([0-9a-f]{40})\//.exec(s.url)![1]);
		expect(notHeld).toHaveLength(8);
		expect(notHeld.some((hash) => held.has(hash))).toBe(false);
	});

	it('reads Peerflix, whose hash sits at another depth of its URL', () => {
		const { torrents, available } = parseAddonStreams(peerflixMovie);

		expect(available).toHaveLength(12);
		expect(torrents.every((t) => /^[0-9a-f]{40}$/.test(t.hash))).toBe(true);
		expect(torrents[0].hash).toBe('4927c5658396e63e40bc9061bd805a7bb1e06966');
	});

	it("keeps a season pack under the torrent's own name", () => {
		const { torrents } = parseAddonStreams(torrentioSeason);

		expect(torrents.map((t) => t.title)).toContain(
			'Breaking.Bad.SEASON.01.S01.COMPLETE.1080p.10bit.BluRay.6CH.x265.HEVC-PSA'
		);
	});
});
