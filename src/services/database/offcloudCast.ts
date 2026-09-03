import { DatabaseClient } from './client';

export interface OffcloudCastStream {
	url: string;
	size: number;
	filename: string;
	hash: string;
	path: string | null;
}

/**
 * Offcloud casts hold a hash and a file path, never a link.
 *
 * Two measured facts force it. `POST /api/cloud` is idempotent by hash and
 * answers `downloaded` synchronously for cached content, so a viewer resolves
 * the release with their own key at play time and nothing stored here can rot.
 * And an Offcloud CDN URL carries an **account-scoped token** in its path - the
 * same secret for every file and every mint - so a stored link would be the
 * caster's credential handed to whoever opens the stream list.
 *
 * The backend is Premiumize's storage (identical energycdn objects, caches
 * identical to the hash), which is why this table is shaped exactly like
 * `PremiumizeCast`.
 */
export class OffcloudCastService extends DatabaseClient {
	public async saveCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.prisma.offcloudCastProfile.upsert({
			where: { userId },
			update: {
				apiKey,
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
				updatedAt: new Date(),
			},
			create: {
				userId,
				apiKey,
				movieMaxSize: movieMaxSize ?? 0,
				episodeMaxSize: episodeMaxSize ?? 0,
				otherStreamsLimit: otherStreamsLimit ?? 5,
				hideCastOption: hideCastOption ?? false,
				updatedAt: new Date(),
			},
		});
	}

	/**
	 * Settings-only update for a profile that already exists, keyed by the cast
	 * user id the client already holds. Never touches apiKey, so callers do not
	 * need the key in hand and no Offcloud call is required to resync settings.
	 */
	public async updateCastSettings(
		userId: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	): Promise<boolean> {
		const { count } = await this.prisma.offcloudCastProfile.updateMany({
			where: { userId },
			data: {
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
				updatedAt: new Date(),
			},
		});
		return count > 0;
	}

	public async getCastProfile(userId: string): Promise<{
		apiKey: string;
		movieMaxSize: number;
		episodeMaxSize: number;
		otherStreamsLimit?: number;
		hideCastOption?: boolean;
	} | null> {
		return this.prisma.offcloudCastProfile.findUnique({
			where: { userId },
			select: {
				apiKey: true,
				movieMaxSize: true,
				episodeMaxSize: true,
				otherStreamsLimit: true,
				hideCastOption: true,
			},
		});
	}

	public async saveCast(
		imdbId: string,
		userId: string,
		hash: string,
		filename: string,
		fileSize: number,
		path?: string
	): Promise<void> {
		await this.prisma.offcloudCast.upsert({
			where: { imdbId_userId_hash: { imdbId, userId, hash } },
			update: { imdbId, url: filename, size: BigInt(fileSize), path },
			create: { imdbId, userId, hash, url: filename, size: BigInt(fileSize), path },
		});
	}

	public async fetchCastedMovies(userId: string): Promise<string[]> {
		const movies = await this.prisma.offcloudCast.findMany({
			where: { userId, imdbId: { not: { contains: ':' } } },
			orderBy: { updatedAt: 'desc' },
			distinct: ['imdbId'],
			select: { imdbId: true },
		});
		return movies.map((movie) => movie.imdbId);
	}

	public async fetchCastedShows(userId: string): Promise<string[]> {
		const shows = await this.prisma.offcloudCast.findMany({
			where: { userId, imdbId: { contains: ':' } },
			orderBy: { updatedAt: 'desc' },
			select: { imdbId: true },
		});
		return shows
			.map((show) => show.imdbId.split(':')[0])
			.filter((value, index, self) => self.indexOf(value) === index);
	}

	public async fetchAllCastedLinks(
		userId: string
	): Promise<{ imdbId: string; url: string; hash: string; size: number; updatedAt: Date }[]> {
		const castItems = await this.prisma.offcloudCast.findMany({
			where: { userId },
			select: { imdbId: true, url: true, hash: true, size: true, updatedAt: true },
			orderBy: { updatedAt: 'desc' },
		});
		return castItems.map((item) => ({ ...item, size: Number(item.size) }));
	}

	// Returns false when there was no matching row, so callers can answer 404
	// instead of reporting a server error for something that isn't there.
	public async deleteCastedLink(imdbId: string, userId: string, hash: string): Promise<boolean> {
		const { count } = await this.prisma.offcloudCast.deleteMany({
			where: { imdbId, userId, hash },
		});
		return count > 0;
	}

	public async getUserCastStreams(
		imdbId: string,
		userId: string,
		limit: number = 5
	): Promise<OffcloudCastStream[]> {
		const castItems = await this.prisma.offcloudCast.findMany({
			where: { imdbId, userId },
			orderBy: { updatedAt: 'desc' },
			select: { url: true, size: true, hash: true, path: true },
			take: limit,
		});

		return castItems.map((item) => ({
			url: item.url,
			size: Number(item.size),
			filename: item.url.split('/').pop() || 'Unknown',
			hash: item.hash,
			path: item.path,
		}));
	}

	/**
	 * Other users' casts for the same title.
	 *
	 * Deliberately unbounded by age, unlike the Real-Debrid pool: there is no
	 * stored link here to rot. What can change is whether Offcloud still holds
	 * the hash, and the stream route settles that with a live `POST /api/cache`
	 * before offering anything - a free, non-destructive, batched probe that
	 * swallowed 5,000 hashes in 2.1 s.
	 */
	public async getOtherStreams(
		imdbId: string,
		userId: string,
		limit: number = 5,
		maxSize?: number
	): Promise<OffcloudCastStream[]> {
		if (limit <= 0) {
			return [];
		}

		const hasMaxSize = typeof maxSize === 'number' && maxSize > 0;
		const maxSizeCastLimit = hasMaxSize ? BigInt(Math.round(maxSize * 1024)) : undefined;

		const where = {
			imdbId,
			size: { gt: 10, ...(maxSizeCastLimit !== undefined && { lte: maxSizeCastLimit }) },
			userId: { not: userId },
		};

		// Deduplicate by size in SQL rather than with Prisma's `distinct`:
		// `distinct` makes Prisma drop the SQL LIMIT and pull every row for the
		// title just to keep `limit` of them.
		const sizeGroups = await this.prisma.offcloudCast.groupBy({
			by: ['size'],
			where,
			orderBy: { size: 'desc' },
			take: limit,
		});

		const rows = (
			await Promise.all(
				sizeGroups.map((group) =>
					this.prisma.offcloudCast.findFirst({
						where: { ...where, size: group.size },
						select: { url: true, size: true, hash: true, path: true },
					})
				)
			)
		).filter((item): item is NonNullable<typeof item> => item !== null);

		return rows.map((item) => ({
			url: item.url,
			size: Number(item.size),
			filename: item.url.split('/').pop() || 'Unknown',
			hash: item.hash,
			path: item.path,
		}));
	}
}
