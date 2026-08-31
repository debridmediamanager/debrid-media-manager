import { describe, expect, it } from 'vitest';
import { parseBytes, parseDebridioStreams } from './debridio';

// Fixtures are verbatim entries from live addon responses (2026-08-30), trimmed
// to the fields the parser reads.

const CACHED_REMUX = {
	name: '[RD ⚡] \nDebridio 4k HDR REMUX',
	title: 'The.Shawshank.Redemption.1994.MULTI.2160p.UHD.BluRay.HDR.REMUX.HEVC-LTN\n⚡ 📺 4k 💾 56.99 GB  \n🌐 Multi Audio',
	url: 'https://addon.debridio.com/play/movie/realdebrid/10d20568d2f96886d67e466dde3ea6e7/CFXTZMPRYMGS3QI2MESPREXO5D5OWP76JTRVYXG3TJFOIZN3C2HQ/a9270b009f4e20ec39a1b02f1c782e1b774e108f/The.Shawshank.Redemption.1994.MULTI.2160p.UHD.BluRay.HDR.REMUX.HEVC-LTN',
	behaviorHints: {
		bingeGroup: 'debridio-a9270b009f4e20ec39a1b02f1c782e1b774e108f',
		filename: 'The.Shawshank.Redemption.1994.MULTI.2160p.UHD.BluRay.HDR.REMUX.HEVC-LTN.mkv',
	},
};

const UNCACHED_EPISODE = {
	name: '[RD] \nDebridio 4k',
	title: 'Breaking.Bad.S01E01.MULTi.2160p.SDR.NF.WEB-DL.DDP5.1.H265-R3DUCT0.mkv\n 📦 📺 4k 💾 5.38 GB 👤 249 \n🌐 Multi Audio|🇫🇷',
	url: 'https://addon.debridio.com/play/series/realdebrid/10d20568d2f96886d67e466dde3ea6e7/CFXTZMPRYMGS3QI2MESPREXO5D5OWP76JTRVYXG3TJFOIZN3C2HQ/76dab5ca28703a78fa027718cbfd347bb1268b75/Breaking.Bad.S01E01.MULTi.2160p.SDR.NF.WEB-DL.DDP5.1.H265-R3DUCT0.mkv',
};

const CACHED_EPISODE = {
	name: '[RD ⚡] \nDebridio 1080p',
	title: 'Breaking.Bad.S01E01.Pilot.1080p.H264.BluRay.mkv\n⚡ 📦 📺 1080p 💾 3.55 GB  ',
	url: 'https://addon.debridio.com/play/series/realdebrid/10d20568d2f96886d67e466dde3ea6e7/CFXTZMPRYMGS3QI2MESPREXO5D5OWP76JTRVYXG3TJFOIZN3C2HQ/01d2c1f3091ef56f08f840525264f51fac34ee9d/Breaking.Bad.S01E01.Pilot.1080p.H264.BluRay.mkv',
	behaviorHints: {
		bingeGroup: 'debridio-01d2c1f3091ef56f08f840525264f51fac34ee9d',
		filename: 'Breaking.Bad.S01E01.Pilot.1080p.H264.BluRay.mkv',
	},
};

const TINY_JUNK = {
	name: '[RD ⚡] \nDebridio 1080p',
	title: '1.mkv\n⚡ 📺 1080p 💾 11.94 MB  ',
	url: 'https://addon.debridio.com/play/series/realdebrid/10d20568d2f96886d67e466dde3ea6e7/CFXTZMPRYMGS3QI2MESPREXO5D5OWP76JTRVYXG3TJFOIZN3C2HQ/b43df67a93863ea91f2f773f00361072da771dd3/1.mkv',
	behaviorHints: {
		bingeGroup: 'debridio-b43df67a93863ea91f2f773f00361072da771dd3',
		filename: '1.mkv',
	},
};

describe('parseBytes', () => {
	it('uses 1024-base units as displayed by debridio', () => {
		// "56.99 GB" is the display rounding of 56.9858 GiB (61,188,068,208
		// bytes, verified against the RD Content-Range of the same file), so the
		// parsed value differs from the true byte count by the rounding only.
		expect(parseBytes('⚡ 📺 4k 💾 56.99 GB')).toBe(61192546550);
		expect(parseBytes('💾 3.55 GB')).toBe(3811783475);
		expect(parseBytes('💾 11.94 MB')).toBe(12519997);
		expect(parseBytes('💾 843.37 MB')).toBe(884337541);
	});

	it('returns 0 when no size marker is present', () => {
		expect(parseBytes('no marker here')).toBe(0);
	});
});

describe('parseDebridioStreams', () => {
	it('extracts hash, release title, MB size and cached flag from a movie stream', () => {
		const { torrents, available } = parseDebridioStreams({ streams: [CACHED_REMUX] });

		expect(torrents).toEqual([
			{
				title: 'The.Shawshank.Redemption.1994.MULTI.2160p.UHD.BluRay.HDR.REMUX.HEVC-LTN',
				fileSize: 58357.76,
				hash: 'a9270b009f4e20ec39a1b02f1c782e1b774e108f',
			},
		]);
		expect(available).toEqual([
			{
				hash: 'a9270b009f4e20ec39a1b02f1c782e1b774e108f',
				filename:
					'The.Shawshank.Redemption.1994.MULTI.2160p.UHD.BluRay.HDR.REMUX.HEVC-LTN.mkv',
				bytes: 61192546550,
			},
		]);
	});

	it('keeps uncached streams as torrents but not as availability', () => {
		const { torrents, available } = parseDebridioStreams({ streams: [UNCACHED_EPISODE] });

		expect(torrents).toHaveLength(1);
		expect(available).toHaveLength(0);
		expect(torrents[0].hash).toBe('76dab5ca28703a78fa027718cbfd347bb1268b75');
	});

	it('drops junk entries under the 100 MB floor entirely', () => {
		const { torrents, available } = parseDebridioStreams({ streams: [TINY_JUNK] });
		expect(torrents).toHaveLength(0);
		expect(available).toHaveLength(0);
	});

	it('keeps entries without a size marker instead of dropping on format drift', () => {
		const noMarker = { ...CACHED_REMUX, title: CACHED_REMUX.title.replace('💾 56.99 GB', '') };
		const { torrents, available } = parseDebridioStreams({ streams: [noMarker] });

		expect(torrents).toHaveLength(1);
		expect(torrents[0].fileSize).toBe(0);
		// Zero-byte availability rows would corrupt file backfill, so a stream
		// with no parsable size is still trusted for the cached flag - the row
		// carries the release name and waits for a real size later.
		expect(available).toHaveLength(1);
		expect(available[0].bytes).toBe(0);
	});

	it('drops streams whose play url has no usable infohash', () => {
		const brokenUrl = {
			...CACHED_REMUX,
			url: 'https://addon.debridio.com/play/movie/realdebrid/key/otherkey/not-a-hash/file',
		};
		const { torrents } = parseDebridioStreams({ streams: [brokenUrl] });
		expect(torrents).toHaveLength(0);
	});

	it('drops entries whose release title carries debridio branding', () => {
		const branded = {
			...CACHED_REMUX,
			title: 'Debridio 4k HDR REMUX\n⚡ 📺 4k 💾 56.99 GB  ',
		};
		const brandedOnly = parseDebridioStreams({ streams: [branded] });
		expect(brandedOnly.torrents).toHaveLength(0);
		expect(brandedOnly.available).toHaveLength(0);

		// Same hash with a clean title still lands; only the branded variant is
		// dropped.
		const mixed = parseDebridioStreams({ streams: [branded, CACHED_REMUX] });
		expect(mixed.torrents).toHaveLength(1);
		expect(mixed.available).toHaveLength(1);
	});

	it('merges episode payloads by hash, ORing the cached flag and keeping the larger size', () => {
		// The same pack seen cached in one episode query and uncached in another.
		const cachedVariant = {
			...CACHED_EPISODE,
			title: CACHED_EPISODE.title.replace('3.55 GB', '2.00 GB'),
		};
		const { torrents, available } = parseDebridioStreams([
			{ streams: [cachedVariant, UNCACHED_EPISODE] },
			{ streams: [CACHED_EPISODE] },
		]);

		expect(torrents).toHaveLength(2);
		const byHash = new Map(torrents.map((t) => [t.hash, t]));
		expect(byHash.get('01d2c1f3091ef56f08f840525264f51fac34ee9d')?.fileSize).toBe(3635.2);
		expect(available.map((a) => a.hash)).toEqual(['01d2c1f3091ef56f08f840525264f51fac34ee9d']);
	});

	it('tolerates an empty or malformed payload', () => {
		expect(parseDebridioStreams({ streams: [] })).toEqual({ torrents: [], available: [] });
		expect(parseDebridioStreams(null)).toEqual({ torrents: [], available: [] });
		expect(parseDebridioStreams({ streams: 'nope' })).toEqual({ torrents: [], available: [] });
	});
});
