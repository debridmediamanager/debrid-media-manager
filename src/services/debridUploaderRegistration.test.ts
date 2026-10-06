import halfFiled from '@/test/fixtures/transfers/half-filed-2026-10-06.json';
import lostFilings from '@/test/fixtures/transfers/lost-filings-2026-10-04.json';
import { describe, expect, it } from 'vitest';
import {
	buildTransferRegistration,
	originalHashFromInput,
	parseTransferContext,
	scrapedKeyFor,
	scrapeEntryFromAvailable,
	TransferJobFile,
} from './debridUploaderRegistration';

// The repair for card 219 rebuilds a dropped entry from its `Available` row, so
// that has to give back exactly what filing stored. These are the entries the
// recorded pages still hold, against the `Available` rows filed with them.
describe('scrapeEntryFromAvailable', () => {
	const kept = lostFilings.pages.flatMap((page) =>
		page.filings
			.filter((f) => f.inPage)
			.map((f) => ({ f, stored: page.page.results.find((r) => r.hash === f.hash)! }))
	);

	it.each(kept.map(({ f, stored }) => [f.title, f, stored]))(
		'rebuilds the entry filing stored for %s',
		(_title, f, stored) => {
			expect(
				scrapeEntryFromAvailable({
					hash: f.hash,
					filename: f.title,
					bytes: BigInt(f.availableBytes),
				})
			).toEqual(stored);
		}
	);

	it('covers every entry the recorded pages hold', () => {
		expect(kept).toHaveLength(6);
	});

	it('files under the same page key as a registration', () => {
		expect(scrapedKeyFor('tt0837069', { mediaType: 'tv', seasonNum: 1 })).toBe(
			'tv:tt0837069:1'
		);
		expect(scrapedKeyFor('tt1234567', { mediaType: 'movie' })).toBe('movie:tt1234567');
		expect(build()?.scrapedKey).toBe('movie:tt1234567');
	});
});

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

// `Available.filename` and `.originalFilename` are varchar(191). The title used
// to be cut at 255 and the raw name not at all, so a release named past 191
// characters filed its page entry and then failed the `Available` insert, on
// every retry. These are three of the seven such releases production held on
// 2026-10-06, as their services served them.
describe('buildTransferRegistration with names past varchar(191)', () => {
	const chars = (value: string) => Array.from(value).length;
	const jobs = [
		...Object.values(halfFiled.nzb2rd.jobs).map((job) => ({ job, files: job.files })),
		...halfFiled.debrid.listing.map((job) => ({
			job,
			files: (halfFiled.debrid.files as Record<string, TransferJobFile[]>)[job.id],
		})),
	];

	it.each(jobs.map(({ job, files }) => [job.id, job, files] as const))(
		'fits %s into its columns with one title on the page and in Available',
		(_id, job, files) => {
			expect(chars(job.name)).toBeGreaterThan(191);
			const stored = halfFiled.dmm.pages.find((p) => p.entry.hash === job.info_hash)!;

			const reg = buildTransferRegistration({
				infoHash: job.info_hash,
				imdbId: job.imdb_id,
				name: job.name,
				files,
				context: { mediaType: 'tv', seasonNum: 1 },
				endedAt: job.completed_at,
			})!;

			expect(reg.scrapedKey).toBe(stored.key);
			expect(chars(reg.availability.filename)).toBe(191);
			expect(chars(reg.availability.originalFilename)).toBe(191);
			expect(job.name.startsWith(reg.availability.originalFilename)).toBe(true);
			expect(reg.scrapeEntry.title).toBe(reg.availability.filename);
			// What production filed to the page, cut to the column.
			expect(reg.scrapeEntry.title).toBe(
				Array.from(stored.entry.title).slice(0, 191).join('')
			);
			expect(reg.scrapeEntry.fileSize).toBe(stored.entry.fileSize);
		}
	);

	it('counts the column in characters, the way MySQL does', () => {
		const name = `${'Ш'.repeat(100)} ${'🎬'.repeat(100)}.mkv`;
		const reg = build({ name })!;
		expect(chars(reg.availability.filename)).toBe(191);
		expect(chars(reg.availability.originalFilename)).toBe(191);
		// Cut on a character, never inside a surrogate pair.
		expect(reg.availability.originalFilename.endsWith('🎬')).toBe(true);
	});

	it('leaves a name that fits as it was', () => {
		const name = 'N'.repeat(191);
		const reg = build({ name })!;
		expect(reg.availability.filename).toBe(name);
		expect(reg.availability.originalFilename).toBe(name);
	});
});
