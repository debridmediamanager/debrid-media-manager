/**
 * RD Cast's "other streams" pool reads `AvailableFile`, which also holds the
 * Real-Debrid availability learned from Debridio. Those rows have no link: they
 * carry a `debridio:{hash}` marker, and the stream route used to cut it into a
 * play URL made of a slice of the infohash, which RD can only refuse.
 *
 * Driven by what dmmdb really held for three titles on 2026-10-03.
 */
import fixture from '@/test/fixtures/castDebridio/rd-available-files.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CastService } from './cast';

type FileRow = (typeof fixture.titles)[number]['files'][number];

const prismaMock = vi.hoisted(() => ({
	availableFile: { findMany: vi.fn() },
	available: { findMany: vi.fn() },
	cast: { groupBy: vi.fn(), findFirst: vi.fn() },
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const RD = 'https://real-debrid.com/d/';

/**
 * The subset of Prisma's `where` the other-streams queries use, evaluated the
 * way MySQL would against the recorded rows. A filter shape it does not know
 * throws rather than passing everything through.
 */
function linkPasses(link: string, filter: unknown): boolean {
	if (filter === undefined) return true;
	const keys = Object.keys(filter as object);
	if (keys.length === 1 && keys[0] === 'startsWith') {
		// The column collates case-insensitively.
		const prefix = (filter as { startsWith: string }).startsWith.toLowerCase();
		return link.toLowerCase().startsWith(prefix);
	}
	throw new Error(`unsupported link filter ${JSON.stringify(filter)}`);
}

function expectKnownKeys(where: Record<string, unknown>, known: string[]) {
	for (const key of Object.keys(where)) {
		if (!known.includes(key)) throw new Error(`unsupported where key ${key}`);
	}
}

const byBytesDesc = (a: { bytes: number }, b: { bytes: number }) => b.bytes - a.bytes;

function serveTitle(files: FileRow[]) {
	prismaMock.availableFile.findMany.mockImplementation(async ({ where, take }) => {
		expectKnownKeys(where, ['available', 'bytes', 'season', 'episode', 'link']);
		return files
			.filter((f) => where.season === undefined || f.season === where.season)
			.filter((f) => where.episode === undefined || f.episode === where.episode)
			.filter((f) => linkPasses(f.link, where.link))
			.sort(byBytesDesc)
			.slice(0, take)
			.map((f) => ({ link: f.link, path: f.path, bytes: BigInt(f.bytes), hash: f.hash }));
	});

	prismaMock.available.findMany.mockImplementation(async ({ where, select, take }) => {
		expectKnownKeys(where, ['imdbId', 'status', 'updatedAt', 'bytes', 'season', 'episode']);
		const filesSelect = select.files;
		const torrents = new Map<
			string,
			{ hash: string; files: FileRow[] } & FileRow['available']
		>();
		for (const f of files) {
			const torrent = torrents.get(f.hash) ?? { hash: f.hash, ...f.available, files: [] };
			torrent.files.push(f);
			torrents.set(f.hash, torrent);
		}
		return [...torrents.values()]
			.filter((t) => where.season === undefined || t.season === where.season)
			.filter((t) => where.episode === undefined || t.episode === where.episode)
			.sort(byBytesDesc)
			.slice(0, take)
			.map((t) => ({
				hash: t.hash,
				filename: t.filename,
				files: t.files
					.filter((f) => linkPasses(f.link, filesSelect.where?.link))
					.sort(byBytesDesc)
					.slice(0, filesSelect.take)
					.map((f) => ({
						link: f.link,
						path: f.path,
						bytes: BigInt(f.bytes),
						season: f.season,
						episode: f.episode,
					})),
			}));
	});
}

const titleOf = (id: string) => fixture.titles.find((t) => t.id === id)!;

describe('RD Cast other streams and Debridio availability rows', () => {
	let service: CastService;

	beforeEach(() => {
		service = new CastService();
		vi.clearAllMocks();
		// Nobody else cast these: what is offered comes from AvailableFile alone.
		prismaMock.cast.groupBy.mockResolvedValue([]);
	});

	it.each(['tt0903747:1:1', 'tt0396269'])(
		'offers %s only through Real-Debrid links, filling the list past the markers',
		async (id) => {
			const { files } = titleOf(id);
			expect(files.some((f) => f.link.startsWith('debridio:'))).toBe(true);
			serveTitle(files);

			const streams = await service.getOtherStreams(id, 'viewer000001', 5);

			const playable = files.filter((f) => f.link.startsWith(RD)).slice(0, 5);
			expect(streams.map((s) => s.link)).toEqual(playable.map((f) => f.link));
		}
	);

	// Its only availability row is a marker; it used to come back twice, once as
	// a file and once as the torrent's biggest file.
	it('offers nothing from AvailableFile for a title only Debridio knows', async () => {
		const { files } = titleOf('tt0110364');
		expect(files.map((f) => f.link)).toEqual([
			'debridio:87d0b04f3b103b399a2afe24055425af28f4f7c4',
		]);
		serveTitle(files);

		const streams = await service.getOtherStreams('tt0110364', 'viewer000001', 5);

		expect(streams).toEqual([]);
	});
});
