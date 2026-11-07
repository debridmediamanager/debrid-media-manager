import { DatabaseClient } from './client';

export interface EasynewsCastStream {
	url: string;
	size: number;
	filename: string;
	hash: string;
	path: string;
}

/**
 * Easynews casts hold a file's path, never a link.
 *
 * Easynews signs a new download link on every request and the link needs no
 * login, so the play route asks for one with the viewer's own account. A link
 * minted by the caster would also put their account behind someone else's
 * player, which Easynews forbids. Nothing stored here can rot except the file
 * itself, and play says so when Easynews no longer has it.
 */
export class EasynewsCastService extends DatabaseClient {
	public async saveCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.prisma.easynewsCastProfile.upsert({
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
	 * need the login in hand and no Easynews call is required to resync settings.
	 */
	public async updateCastSettings(
		userId: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	): Promise<boolean> {
		const { count } = await this.prisma.easynewsCastProfile.updateMany({
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
		return this.prisma.easynewsCastProfile.findUnique({
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
		path: string
	): Promise<void> {
		await this.prisma.easynewsCast.upsert({
			where: { imdbId_userId_hash: { imdbId, userId, hash } },
			update: { imdbId, url: filename, size: BigInt(fileSize), path },
			create: { imdbId, userId, hash, url: filename, size: BigInt(fileSize), path },
		});
	}

	public async fetchCastedMovies(userId: string): Promise<string[]> {
		const movies = await this.prisma.easynewsCast.findMany({
			where: { userId, imdbId: { not: { contains: ':' } } },
			orderBy: { updatedAt: 'desc' },
			distinct: ['imdbId'],
			select: { imdbId: true },
		});
		return movies.map((movie) => movie.imdbId);
	}

	public async fetchCastedShows(userId: string): Promise<string[]> {
		const shows = await this.prisma.easynewsCast.findMany({
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
		const castItems = await this.prisma.easynewsCast.findMany({
			where: { userId },
			select: { imdbId: true, url: true, hash: true, size: true, updatedAt: true },
			orderBy: { updatedAt: 'desc' },
		});
		return castItems.map((item) => ({ ...item, size: Number(item.size) }));
	}

	// Returns false when there was no matching row, so callers can answer 404
	// instead of reporting a server error for something that isn't there.
	public async deleteCastedLink(imdbId: string, userId: string, hash: string): Promise<boolean> {
		const { count } = await this.prisma.easynewsCast.deleteMany({
			where: { imdbId, userId, hash },
		});
		return count > 0;
	}

	public async getUserCastStreams(
		imdbId: string,
		userId: string,
		limit: number = 5
	): Promise<EasynewsCastStream[]> {
		const castItems = await this.prisma.easynewsCast.findMany({
			where: { imdbId, userId },
			orderBy: { updatedAt: 'desc' },
			select: { url: true, size: true, hash: true, path: true },
			take: limit,
		});

		return castItems.map((item) => ({
			url: item.url,
			size: Number(item.size),
			filename: item.url || 'Unknown',
			hash: item.hash,
			path: item.path,
		}));
	}

	/**
	 * Other users' casts for the same title. Any Easynews account can fetch any
	 * file its plan's retention covers, so these play with the viewer's login.
	 */
	public async getOtherStreams(
		imdbId: string,
		userId: string,
		limit: number = 5,
		maxSize?: number
	): Promise<EasynewsCastStream[]> {
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
		const sizeGroups = await this.prisma.easynewsCast.groupBy({
			by: ['size'],
			where,
			orderBy: { size: 'desc' },
			take: limit,
		});

		const rows = (
			await Promise.all(
				sizeGroups.map((group) =>
					this.prisma.easynewsCast.findFirst({
						where: { ...where, size: group.size },
						select: { url: true, size: true, hash: true, path: true },
					})
				)
			)
		).filter((item): item is NonNullable<typeof item> => item !== null);

		return rows.map((item) => ({
			url: item.url,
			size: Number(item.size),
			filename: item.url || 'Unknown',
			hash: item.hash,
			path: item.path,
		}));
	}
}
