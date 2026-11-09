import type { PlacedRelease, PlaceRequest } from '@/services/placement';
import { withoutBlockedHashList } from '@/services/takedown/blocklist';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { DatabaseClient } from './client';

/** The unplaced files a miss keeps; a pack of extras can hold hundreds. */
const MAX_FILES = 100;

export interface PlacementMissRow {
	id: string;
	hash: string | null;
	name: string;
	kind: 'movie' | 'tv' | null;
	imdbId: string | null;
	tmdbId: number | null;
	fileCount: number;
	files: string[];
}

/** A release's row: its hash and name, as a film collection asks each film under the pack's hash. */
const missId = (release: PlaceRequest) =>
	createHash('sha1')
		.update(`${release.hash ?? ''}|${release.name}`)
		.digest('hex');

/**
 * What a place request could not place, by the measure zurg's Torrent Manager uses for
 * Unplaced: no film or show at all, or a show's file numbered as no episode nor named a film
 * of its own. `placed` are the releases placed whole, whose earlier misses are settled. A
 * skipped release is neither: zurg asks again.
 */
export function placementMisses(
	requests: PlaceRequest[],
	answers: PlacedRelease[]
): { missed: PlacementMissRow[]; placed: string[] } {
	// a release asked in parts (over 2,000 files) is one release
	const releases = new Map<string, PlacementMissRow>();
	requests.forEach((release, at) => {
		const answer = answers[at];
		if (!answer || answer.skipped) return;
		const id = missId(release);
		const identified =
			answer.kind !== null && (answer.imdbId !== null || answer.tmdbId !== null);
		// a series DMM numbers itself (One Pace) places the files it gives an episode of it
		const unplaced = answer.series
			? answer.files.filter((file) => !file.series)
			: !identified
				? answer.files
				: answer.kind === 'tv'
					? answer.files.filter((file) => file.episode === null && file.kind !== 'movie')
					: [];
		const row = releases.get(id);
		releases.set(id, {
			id,
			hash: release.hash,
			name: release.name,
			kind: answer.kind,
			imdbId: answer.imdbId,
			tmdbId: answer.tmdbId,
			fileCount: (row?.fileCount ?? 0) + release.files.length,
			files: [...(row?.files ?? []), ...unplaced.map((file) => file.path)].slice(
				0,
				MAX_FILES
			),
		});
	});
	const rows = [...releases.values()];
	return {
		missed: rows.filter((row) => row.files.length),
		placed: rows.filter((row) => !row.files.length).map((row) => row.id),
	};
}

/**
 * The releases sponsors' zurg asked DMM to place that it could not, kept to improve the rules:
 * one row a release, counting how often it was asked, dropped once a request places it.
 */
export class PlacementMissService extends DatabaseClient {
	public async record(
		requests: PlaceRequest[],
		answers: PlacedRelease[],
		rules: string
	): Promise<void> {
		const { missed, placed } = placementMisses(requests, answers);
		if (placed.length)
			await this.prisma.placementMiss.deleteMany({ where: { id: { in: placed } } });
		const allowed = new Set(
			await withoutBlockedHashList([...new Set(missed.flatMap((row) => row.hash ?? []))])
		);
		const rows = missed.filter((row) => row.hash === null || allowed.has(row.hash));
		if (!rows.length) return;
		await this.prisma.$executeRaw`
			INSERT INTO PlacementMiss (id, hash, name, kind, imdbId, tmdbId, fileCount, files, rules)
			VALUES ${Prisma.join(
				rows.map(
					(row) =>
						Prisma.sql`(${row.id}, ${row.hash}, ${row.name.slice(0, 1024)}, ${row.kind}, ${row.imdbId}, ${row.tmdbId}, ${row.fileCount}, ${JSON.stringify(row.files)}, ${rules})`
				)
			)}
			ON DUPLICATE KEY UPDATE kind = VALUES(kind), imdbId = VALUES(imdbId), tmdbId = VALUES(tmdbId),
				fileCount = VALUES(fileCount), files = VALUES(files), rules = VALUES(rules),
				asks = asks + 1, lastSeen = CURRENT_TIMESTAMP(3)`;
	}
}
