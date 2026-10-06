// @vitest-environment node
import rdManifest from '@/pages/api/stremio/[userid]/manifest.json';
import recorded from '@/test/fixtures/castLibrary/rd-library-2026-10-03.json';
import verdictsByHash from '@/test/fixtures/castLibrary/rd-library-verdicts-by-hash-2026-10-06.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * debrid-media-manager#153 (Fizzy card 48): a DMM Cast library showed in
 * Stremio as "DMM RD Library - Other", every tile a blank placeholder with no
 * title behind it. The catalog sent `{ id, name, type }` and nothing else, so
 * no Stremio client had a cover to draw - although DMM already knew what most
 * of those releases were, from the same tables the "cast from library" button
 * reads.
 *
 * Everything here is recorded: the Real-Debrid test 2 account's library as RD
 * listed it, what debridmediamanager.com served for it at the same moment, and
 * the dmmdb rows for those hashes. The verdicts are every ScrapedVerdict row
 * on those hashes, read by hash on 2026-10-06 as the catalog now reads them.
 * Only the database client is faked, by a stand-in that answers from those
 * rows, so the real repository and services run end to end.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const fake = vi.hoisted(() => ({
	prisma: {} as Record<string, unknown>,
	queries: [] as Array<{ model: string; where: Record<string, unknown> }>,
}));

vi.mock('@/services/database/client', () => ({
	DatabaseClient: class {
		prisma = fake.prisma;
		async disconnect() {}
	},
}));

vi.mock('@/services/realDebrid', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/realDebrid')>()),
	getUserTorrentsList: vi.fn(),
	getTorrentInfo: vi.fn(),
}));

import { getTorrentInfo, getUserTorrentsList } from '@/services/realDebrid';
import { getDMMLibrary, getDMMTorrent } from '@/utils/castCatalogHelper';

const CAST_USER = 'USERID';
const RD_TOTAL = 104459;

// MySQL compares these columns case-insensitively, so the stand-in does too.
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();

const matches = (row: Row, where: Where) =>
	Object.entries(where).every(([field, condition]) =>
		condition && typeof condition === 'object' && 'in' in condition
			? (condition.in as unknown[]).some((value) => same(row[field], value))
			: same(row[field], condition)
	);

const project = (row: Row, select?: Record<string, boolean>) =>
	select ? Object.fromEntries(Object.keys(select).map((field) => [field, row[field]])) : row;

const table = (model: string, rows: Row[]) => ({
	findMany: async ({
		where = {},
		select,
	}: {
		where?: Where;
		select?: Record<string, boolean>;
	}) => {
		fake.queries.push({ model, where });
		return rows.filter((row) => matches(row, where)).map((row) => project(row, select));
	},
});

function installRecordedDatabase() {
	const { db } = recorded;
	Object.assign(fake.prisma, {
		castProfile: {
			findUnique: async ({ where }: { where: { userId: string } }) =>
				where.userId === CAST_USER
					? {
							clientId: null,
							clientSecret: null,
							refreshToken: null,
							apiKey: 'rd-api-key',
							movieMaxSize: 0,
							episodeMaxSize: 0,
						}
					: null,
		},
		hashImdb: table('hashImdb', db.hashImdb),
		available: table('available', db.available),
		availableAd: table('availableAd', db.availableAd),
		scrapedVerdict: table('scrapedVerdict', verdictsByHash.scrapedVerdict),
		imdbTitleBasics: table('imdbTitleBasics', [
			...db.imdbTitleBasics,
			...verdictsByHash.imdbTitleBasics,
		]),
	});
}

const poster = (imdbId: string) => `https://images.metahub.space/poster/small/${imdbId}/img`;

describe('DMM Cast library art, from a recorded Real-Debrid library', () => {
	beforeAll(() => {
		process.env.DMM_ORIGIN = 'https://debridmediamanager.com';
	});

	beforeEach(() => {
		installRecordedDatabase();
		fake.queries.length = 0;
		vi.mocked(getUserTorrentsList).mockResolvedValue({
			data: recorded.rdTorrentsPage as any,
			totalCount: RD_TOTAL,
		});
		vi.mocked(getTorrentInfo).mockResolvedValue(recorded.rdTorrentInfo as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('lists the same releases production listed, in the same order', async () => {
		const result = await getDMMLibrary(CAST_USER, 1);

		expect(result.status).toBe(200);
		const metas = (result as any).data.metas;
		expect(metas.map(({ id, name, type }: any) => ({ id, name, type }))).toEqual(
			recorded.productionCatalog.metas
		);
		expect((result as any).data.hasMore).toBe(recorded.productionCatalog.hasMore);
	});

	/**
	 * Hand-checked against each release name. The name stays the release - a
	 * library holds several releases of one film, and they must still read
	 * apart - and the title DMM matched rides alongside it.
	 */
	it('gives every release DMM can identify its cover and title', async () => {
		const expected: Record<string, { imdbId: string; title: string; year: string }> = {
			// Inception.2010.2160p.BluRay.HEVC.DTS-HD.MA.5.1-COASTER
			BBNXE2XV5GV6S: { imdbId: 'tt1375666', title: 'Inception', year: '2010' },
			// The Housemaid 2025 1080p BluRay x264-OFT.mkv
			IS3GJBY3Q57QE: { imdbId: 'tt27543632', title: 'The Housemaid', year: '2025' },
			// Interstellar (2014).mkv
			X2ILDQNYFYOHM: { imdbId: 'tt0816692', title: 'Interstellar', year: '2014' },
			// The.Housemaid.2025.MULTi.VFQ.1080p.WEBrip...
			PN3LSTL4KHSZ2: { imdbId: 'tt27543632', title: 'The Housemaid', year: '2025' },
			// Inception.2010.2160p.UHD.BDRemux...DVT
			AUUIRWO663Y6Q: { imdbId: 'tt1375666', title: 'Inception', year: '2010' },
			// Only AvailableAd knows this one.
			'66U5KUQMLHB3M': {
				imdbId: 'tt0111161',
				title: 'The Shawshank Redemption',
				year: '1994',
			},
			// Verdicts trashed this hash on Part II and Part III and kept it here.
			FO4AGGIBZRVWE: { imdbId: 'tt0068646', title: 'The Godfather', year: '1972' },
			JVNRKR5CGE3FK: { imdbId: 'tt8367814', title: 'The Gentlemen', year: '2019' },
			// Interstellar (2014) BR-Rip - x264 - [Tamil Dub]
			R2PGHKOYWZ7OM: { imdbId: 'tt0816692', title: 'Interstellar', year: '2014' },
		};

		const result = await getDMMLibrary(CAST_USER, 1);
		const metas = (result as any).data.metas as Array<Record<string, string>>;

		for (const [torrentId, { imdbId, title, year }] of Object.entries(expected)) {
			const meta = metas.find((m) => m.id === `dmm:${torrentId}`);
			expect(meta, torrentId).toMatchObject({
				poster: poster(imdbId),
				background: `https://images.metahub.space/background/medium/${imdbId}/img`,
				description: title,
				releaseInfo: year,
			});
		}
	});

	/**
	 * Fizzy card 216. Both are known only to a ScrapedVerdict keep. Every
	 * verdict index used to start with imdbId, so the catalog read verdicts only
	 * for titles another table proposed and left these two bare. With
	 * ScrapedVerdict_hash_idx it reads verdicts by hash alone, an indexed read.
	 */
	it('identifies a release only a keep verdict knows, reading verdicts by hash', async () => {
		const expected: Record<string, { imdbId: string; title: string; year: string }> = {
			// The-Shawshank-Redemption_1994_AI_1080p.BluRay.10b.HEVC.DTS-MA.5.1_BLUD
			HRQDMPC46ZKT2: { imdbId: 'tt0111161', title: 'The Shawshank Redemption', year: '1994' },
			// Avengers.Endgame.2019.1080p.BluRay.AVC.DTS-HD.MA.7.1-FGT
			OGFIBP3UXFU6I: { imdbId: 'tt4154796', title: 'Avengers: Endgame', year: '2019' },
		};

		const result = await getDMMLibrary(CAST_USER, 1);
		const metas = (result as any).data.metas as Array<Record<string, string>>;

		for (const [torrentId, { imdbId, title, year }] of Object.entries(expected)) {
			const meta = metas.find((m) => m.id === `dmm:${torrentId}`);
			expect(meta, torrentId).toMatchObject({
				poster: poster(imdbId),
				description: title,
				releaseInfo: year,
			});
		}
		const reads = fake.queries.filter(({ model }) => model === 'scrapedVerdict');
		expect(reads.length).toBeGreaterThan(0);
		for (const { where } of reads) expect(Object.keys(where)).toEqual(['hash']);
	});

	it('hands Stremio values its meta preview parses', async () => {
		const result = await getDMMLibrary(CAST_USER, 1);
		const metas = (result as any).data.metas as Array<Record<string, unknown>>;
		const dressed = metas.filter((m) => 'poster' in m);

		expect(dressed.length).toBeGreaterThan(0);
		for (const meta of dressed) {
			expect(() => new URL(meta.poster as string)).not.toThrow();
			expect(() => new URL(meta.background as string)).not.toThrow();
			expect(typeof meta.description).toBe('string');
			expect(typeof meta.releaseInfo).toBe('string');
		}
	});

	it('gives the opened release the same art, and changes nothing else', async () => {
		const result = await getDMMTorrent(CAST_USER, 'X2ILDQNYFYOHM', 'rd-api-key');

		expect(result.status).toBe(200);
		expect((result as any).data).toEqual({
			...recorded.productionMeta,
			meta: {
				...recorded.productionMeta.meta,
				poster: poster('tt0816692'),
				background: 'https://images.metahub.space/background/medium/tt0816692/img',
				description: 'Interstellar',
				releaseInfo: '2014',
			},
		});
	});

	it('still lists the library when dmmdb cannot be read', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		(fake.prisma.available as any).findMany = async () => {
			throw new Error('Connection lost');
		};

		const result = await getDMMLibrary(CAST_USER, 1);

		expect(result.status).toBe(200);
		expect((result as any).data.metas).toEqual(recorded.productionCatalog.metas);
	});

	/**
	 * The art changes catalog and meta responses only. The manifest Stremio
	 * installed still describes them, so existing installs get covers on their
	 * next catalog request without the addon version moving.
	 */
	it('serves the manifest existing installs hold', async () => {
		const res = createMockResponse();
		await rdManifest(createMockRequest({ query: { userid: CAST_USER } }), res);

		expect(res._getData()).toEqual(recorded.productionManifest);
	});
});

/**
 * The whole recorded slice: the first 100 releases of the library, graded
 * against every keep verdict dmmdb holds for them. Those verdicts were read
 * with a full scan when the fixture was made, which is exactly what the
 * catalog cannot afford per request, so they grade the picks without feeding
 * them.
 */
describe('library identification over 100 recorded releases', () => {
	beforeEach(() => {
		installRecordedDatabase();
	});

	it('never picks a title a verdict threw the release off, and agrees with kept ones', async () => {
		const { repository } = await import('@/services/repository');
		const hashes = recorded.rdTorrents.map((torrent) => torrent.hash);

		const identities = await repository.identifyLibraryHashes(hashes);

		const verdicts = new Map<string, Set<string>>();
		for (const { hash, imdbId, verdict } of verdictsByHash.scrapedVerdict) {
			const key = `${hash}|${imdbId}`;
			verdicts.set(key, (verdicts.get(key) ?? new Set()).add(verdict));
		}
		const kept = new Map<string, Set<string>>();
		for (const { hash, imdbId } of recorded.reference.keepVerdicts) {
			kept.set(hash, (kept.get(hash) ?? new Set()).add(imdbId));
		}

		let graded = 0;
		let agreed = 0;
		for (const [hash, { imdbId }] of identities) {
			const seen = verdicts.get(`${hash}|${imdbId}`);
			expect(seen?.has('trash') && !seen.has('keep'), `${hash} -> ${imdbId}`).toBeFalsy();
			const keeps = kept.get(hash);
			if (keeps) {
				graded++;
				if (keeps.has(imdbId)) agreed++;
			}
		}

		const unique = new Set(hashes.map((hash) => hash.toLowerCase())).size;
		expect(identities.size / unique).toBeGreaterThan(0.75);
		expect(graded).toBeGreaterThan(50);
		expect(agreed / graded).toBeGreaterThan(0.95);
	});
});

/**
 * Fizzy card 216. Of the 96 recorded hashes, 13 are in no mapping table. Read
 * by hash, the verdicts name 11 of them: each was kept on one title only. The
 * other two stay bare - a set kept on the page of every film it holds, and a
 * release no verdict kept.
 */
describe('releases only a verdict knows, over 100 recorded releases', () => {
	beforeEach(() => {
		installRecordedDatabase();
	});

	it('names a release after the one title it was kept on, and leaves a set bare', async () => {
		const { repository } = await import('@/services/repository');
		const byId = new Map(recorded.rdTorrents.map((t) => [t.id, t.hash.toLowerCase()]));

		const identities = await repository.identifyLibraryHashes(
			recorded.rdTorrents.map((torrent) => torrent.hash)
		);

		const expected: Record<string, string> = {
			HRQDMPC46ZKT2: 'tt0111161',
			OGFIBP3UXFU6I: 'tt4154796',
			P5NVOAPJZ3B4S: 'tt4154796',
			AGBSAA5SEPWNY: 'tt0816692',
			HJ77JBFFORPEQ: 'tt0816692',
			OKC5LHY6AX2BQ: 'tt0816692',
			'4HH7OGYVROEVW': 'tt1375666',
			WF36PW3O6GUDO: 'tt26581740',
			JQLDZOCWRP37Y: 'tt0120804',
			// Monster 2003 1080p BluRay x265-YAWNTiC.mkv and the YTS release
			VL44SCJ6CWZ4C: 'tt0340855',
			NACFEHPWCHYAM: 'tt0340855',
		};
		for (const [torrentId, imdbId] of Object.entries(expected)) {
			expect(identities.get(byId.get(torrentId)!)?.imdbId, torrentId).toBe(imdbId);
		}
		expect(identities.get(byId.get('VL44SCJ6CWZ4C')!)).toEqual({
			imdbId: 'tt0340855',
			title: 'Monster',
			year: 2003,
		});
		// Al.Pacino.Movies.Pack.MiXeD-SCENEXPRESS, kept on eleven of its films
		expect(identities.has(byId.get('MZRSSDO7GBQPA')!)).toBe(false);
		// Essential Films 2 Mp4 1080p, never kept anywhere
		expect(identities.has(byId.get('OGRWFUTZTVXVQ')!)).toBe(false);
	});
});
