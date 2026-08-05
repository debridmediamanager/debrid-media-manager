import { describe, expect, it } from 'vitest';
import {
	buildTransferRegistration,
	originalHashFromInput,
	parseTransferContext,
	TransferJobFile,
} from './debridUploaderRegistration';

const HASH = 'a'.repeat(40);

const videoFile = (over?: Partial<TransferJobFile>): TransferJobFile => ({
	name: 'Some.Movie.2024.1080p.WEB.H264-GRP.mkv',
	size: 4_000_000_000,
	rd_link: 'https://real-debrid.com/d/ABCDEFGHIJKLM',
	...over,
});

const build = (over?: Partial<Parameters<typeof buildTransferRegistration>[0]>) =>
	buildTransferRegistration({
		infoHash: HASH,
		imdbId: 'tt1234567',
		name: 'Some.Movie.2024.1080p.WEB-DL.H264-GRP',
		files: [videoFile()],
		context: { mediaType: 'movie' },
		...over,
	});

describe('originalHashFromInput', () => {
	it('extracts and lowercases the info hash from a magnet', () => {
		expect(originalHashFromInput(`magnet:?xt=urn:btih:${HASH.toUpperCase()}&dn=x`)).toBe(HASH);
	});
	it('extracts a bare hash', () => {
		expect(originalHashFromInput(HASH)).toBe(HASH);
	});
	it('returns null for non-strings or no hash', () => {
		expect(originalHashFromInput(undefined)).toBeNull();
		expect(originalHashFromInput('no hash here')).toBeNull();
	});
});

describe('parseTransferContext', () => {
	it('accepts movie and tv with a season', () => {
		expect(parseTransferContext('movie', undefined)).toEqual({ mediaType: 'movie' });
		expect(parseTransferContext('tv', '2')).toEqual({ mediaType: 'tv', seasonNum: 2 });
	});

	it('rejects tv without a valid season and unknown types', () => {
		expect(parseTransferContext('tv', undefined)).toBeNull();
		expect(parseTransferContext('tv', '-1')).toBeNull();
		expect(parseTransferContext('anime', '1')).toBeNull();
		expect(parseTransferContext(undefined, undefined)).toBeNull();
	});
});

describe('buildTransferRegistration', () => {
	it('builds a scraped row and availability record for a movie', () => {
		const reg = build();
		expect(reg).not.toBeNull();
		expect(reg!.scrapedKey).toBe('movie:tt1234567');
		expect(reg!.scrapeEntry.hash).toBe(HASH);
		// de-infringed: WEB-DL becomes WEB.DL, so no RD-blocked substring remains
		expect(reg!.scrapeEntry.title).toBe('Some.Movie.2024.1080p.WEB.DL.H264-GRP');
		// MB with two decimals
		expect(reg!.scrapeEntry.fileSize).toBeCloseTo(4_000_000_000 / 1024 / 1024, 1);
		expect(reg!.availability.status).toBe('downloaded');
		expect(reg!.availability.host).toBe('real-debrid.com');
		expect(reg!.availability.progress).toBe(100);
		expect(reg!.availability.selectedFiles).toEqual([
			{
				id: 1,
				path: 'Some.Movie.2024.1080p.WEB.H264-GRP.mkv',
				bytes: 4_000_000_000,
				selected: 1,
			},
		]);
		expect(reg!.availability.links).toEqual(['https://real-debrid.com/d/ABCDEFGHIJKLM']);
	});

	it('files a tv transfer under the season key', () => {
		const reg = build({ context: { mediaType: 'tv', seasonNum: 3 } });
		expect(reg!.scrapedKey).toBe('tv:tt1234567:3');
	});

	it('drops files without an RD link and keeps link/file parity', () => {
		const reg = build({
			files: [
				videoFile(),
				videoFile({ name: 'unlinked.mkv', rd_link: null }),
				videoFile({
					name: 'Some.Movie.2024.Extras.mkv',
					size: 500_000_000,
					rd_link: 'https://real-debrid.com/d/NOPQRSTUVWXYZ',
				}),
			],
		});
		expect(reg!.availability.selectedFiles).toHaveLength(2);
		expect(reg!.availability.links).toHaveLength(2);
		expect(reg!.availability.bytes).toBe(4_500_000_000);
	});

	it('returns null without a video file, a valid hash, or a valid imdb id', () => {
		expect(build({ files: [videoFile({ name: 'readme.nfo' })] }), 'no video file').toBeNull();
		expect(build({ files: [videoFile({ rd_link: null })] }), 'no linked file').toBeNull();
		expect(build({ infoHash: 'nothex' }), 'bad hash').toBeNull();
		expect(build({ imdbId: '1234567' }), 'bad imdb').toBeNull();
	});

	it('falls back to the biggest linked file name when the job has no name', () => {
		const reg = build({ name: null });
		// WEB.H264 is itself an RD-blocked dot pair, so deInfringe breaks it too
		expect(reg!.scrapeEntry.title).toBe('Some.Movie.2024.1080p.WEB-H264-GRP.mkv');
	});

	it('lowercases the hash', () => {
		const reg = build({ infoHash: HASH.toUpperCase() });
		expect(reg!.scrapeEntry.hash).toBe(HASH);
		expect(reg!.availability.hash).toBe(HASH);
	});
});
