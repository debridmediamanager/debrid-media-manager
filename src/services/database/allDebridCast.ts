import { DatabaseClient } from './client';

interface LatestCast {
	url: string;
	link: string;
}

export class AllDebridCastService extends DatabaseClient {
	public async saveCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.prisma.allDebridCastProfile.upsert({
			where: {
				userId: userId,
			},
			update: {
				apiKey,
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
				updatedAt: new Date(),
			},
			create: {
				userId: userId,
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
	 * need the key in hand and no AllDebrid call is required to resync settings.
	 *
	 * Returns false when there is no such profile, so callers can answer 404 and
	 * let the client fall back to a full save.
	 */
	public async updateCastSettings(
		userId: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	): Promise<boolean> {
		const { count } = await this.prisma.allDebridCastProfile.updateMany({
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

	public async getLatestCast(imdbId: string, userId: string): Promise<LatestCast | null> {
		const castItem = await this.prisma.allDebridCast.findFirst({
			where: {
				imdbId: imdbId,
				userId: userId,
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				url: true,
				link: true,
			},
		});
		return castItem && castItem.url && castItem.link
			? { url: castItem.url, link: castItem.link }
			: null;
	}

	public async getCastURLs(
		imdbId: string,
		userId: string
	): Promise<{ url: string; link: string | null; size: number }[]> {
		const castItems = await this.prisma.allDebridCast.findMany({
			where: {
				imdbId: imdbId,
				userId: userId,
				updatedAt: {
					gt: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				url: true,
				size: true,
				link: true,
			},
		});
		return castItems
			.filter(
				(item): item is { url: string; link: string; size: bigint } => item.link !== null
			)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
			}));
	}

	public async getCastProfile(userId: string): Promise<{
		apiKey: string;
		movieMaxSize: number;
		episodeMaxSize: number;
		otherStreamsLimit?: number;
		hideCastOption?: boolean;
	} | null> {
		const profile = await this.prisma.allDebridCastProfile.findUnique({
			where: { userId },
			select: {
				apiKey: true,
				movieMaxSize: true,
				episodeMaxSize: true,
				otherStreamsLimit: true,
				hideCastOption: true,
			},
		});
		return profile;
	}

	public async saveCast(
		imdbId: string,
		userId: string,
		hash: string,
		url: string,
		adLink: string,
		fileSize: number,
		magnetId?: number,
		fileIndex?: number
	): Promise<void> {
		await this.prisma.allDebridCast.upsert({
			where: {
				imdbId_userId_hash: {
					imdbId: imdbId,
					userId: userId,
					hash: hash,
				},
			},
			update: {
				imdbId: imdbId,
				link: adLink,
				url: url,
				size: BigInt(fileSize),
				magnetId: magnetId,
				fileIndex: fileIndex,
			},
			create: {
				imdbId: imdbId,
				userId: userId,
				hash: hash,
				link: adLink,
				url: url,
				size: BigInt(fileSize),
				magnetId: magnetId,
				fileIndex: fileIndex,
			},
		});
	}

	public async fetchCastedMovies(userId: string): Promise<string[]> {
		const movies = await this.prisma.allDebridCast.findMany({
			where: {
				userId: userId,
				imdbId: {
					not: {
						contains: ':', // Excludes shows
					},
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			distinct: ['imdbId'],
			select: {
				imdbId: true,
			},
		});

		return movies.map((movie) => movie.imdbId);
	}

	public async fetchCastedShows(userId: string): Promise<string[]> {
		const showsWithDuplicates = await this.prisma.allDebridCast.findMany({
			where: {
				userId: userId,
				imdbId: {
					contains: ':', // Includes only shows
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				imdbId: true,
			},
		});

		const uniqueShows = showsWithDuplicates
			.map((show) => show.imdbId.split(':')[0]) // Extracts the base imdbId of the show
			.filter((value, index, self) => self.indexOf(value) === index); // Ensures uniqueness

		return uniqueShows;
	}

	public async fetchAllCastedLinks(userId: string): Promise<
		{
			imdbId: string;
			url: string;
			hash: string;
			size: number;
			updatedAt: Date;
		}[]
	> {
		const castItems = await this.prisma.allDebridCast.findMany({
			where: {
				userId: userId,
			},
			select: {
				imdbId: true,
				url: true,
				hash: true,
				size: true,
				updatedAt: true,
			},
			orderBy: {
				updatedAt: 'desc',
			},
		});

		return castItems.map((item) => ({
			...item,
			size: Number(item.size),
		}));
	}

	// Returns false when there was no matching link, so callers can answer 404
	// instead of reporting a server error for something that simply isn't there.
	public async deleteCastedLink(imdbId: string, userId: string, hash: string): Promise<boolean> {
		try {
			const { count } = await this.prisma.allDebridCast.deleteMany({
				where: {
					imdbId,
					userId,
					hash,
				},
			});
			return count > 0;
		} catch (error: any) {
			throw new Error(`Failed to delete casted link: ${error.message}`);
		}
	}

	public async getAllUserCasts(userId: string): Promise<
		{
			imdbId: string;
			hash: string;
			url: string;
			link: string | null;
			size: number;
		}[]
	> {
		const casts = await this.prisma.allDebridCast.findMany({
			where: {
				userId: userId,
			},
			select: {
				imdbId: true,
				hash: true,
				url: true,
				link: true,
				size: true,
			},
		});
		return casts.map((cast) => ({
			imdbId: cast.imdbId,
			hash: cast.hash,
			url: cast.url,
			link: cast.link,
			size: Number(cast.size),
		}));
	}

	/**
	 * The `/f/` link stored for a cast, looked up by the (magnetId, fileIndex)
	 * pair the play URL carries.
	 *
	 * A magnet id only means something inside the account that created it -
	 * AllDebrid answers `MAGNET_INVALID_ID` for anyone else - so resolving a cast
	 * through the id can only ever work for its own caster, and stops working
	 * for them too once they delete the magnet. The `/f/` token is the opposite:
	 * any premium key can unlock it, and it outlives the magnet entry. AllDebrid
	 * allocates magnet ids from a global counter, so the pair identifies one
	 * file regardless of which user's row we find it on.
	 */
	public async getCastLink(magnetId: number, fileIndex: number): Promise<string | null> {
		const cast = await this.prisma.allDebridCast.findFirst({
			where: {
				magnetId,
				fileIndex,
				link: { not: null },
			},
			orderBy: { updatedAt: 'desc' },
			select: { link: true },
		});
		return cast?.link ?? null;
	}

	public async getUserCastStreams(
		imdbId: string,
		userId: string,
		limit: number = 5
	): Promise<
		{
			url: string;
			link: string;
			size: number;
			filename: string;
			hash: string;
			magnetId: number | null;
			fileIndex: number | null;
		}[]
	> {
		const castItems = await this.prisma.allDebridCast.findMany({
			where: {
				imdbId: imdbId,
				userId: userId,
				link: {
					not: null,
				},
				updatedAt: {
					gt: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000),
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				url: true,
				link: true,
				size: true,
				hash: true,
				magnetId: true,
				fileIndex: true,
			},
			take: limit,
		});

		return castItems
			.filter(
				(
					item
				): item is {
					url: string;
					link: string;
					size: bigint;
					hash: string;
					magnetId: number | null;
					fileIndex: number | null;
				} => item.link !== null
			)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
				filename: item.url.split('/').pop() || 'Unknown',
				hash: item.hash,
				magnetId: item.magnetId,
				fileIndex: item.fileIndex,
			}));
	}

	public async getOtherStreams(
		imdbId: string,
		userId: string,
		limit: number = 5,
		maxSize?: number
	): Promise<
		{
			url: string;
			link: string;
			size: number;
			filename: string;
			hash: string;
			magnetId: number | null;
			fileIndex: number | null;
		}[]
	> {
		if (limit <= 0) {
			return [];
		}

		const hasMaxSize = typeof maxSize === 'number' && maxSize > 0;
		const normalizedMaxSizeMb = hasMaxSize ? Math.round(maxSize * 1024) : undefined;
		const maxSizeCastLimit =
			normalizedMaxSizeMb !== undefined ? BigInt(normalizedMaxSizeMb) : undefined;

		const where = {
			imdbId: imdbId,
			link: {
				not: null,
			},
			size: {
				gt: 10,
				...(maxSizeCastLimit !== undefined && { lte: maxSizeCastLimit }),
			},
			userId: {
				not: userId,
			},
		};

		// For AllDebrid, we only get streams from other AllDebrid Cast users
		//
		// Deduplicate by size in SQL rather than with Prisma's `distinct`: `distinct`
		// makes Prisma drop the SQL LIMIT and pull every row for the title just to
		// keep `limit` of them. groupBy returns only the distinct sizes, then one
		// bounded lookup per size fetches the actual rows.
		const sizeGroups = await this.prisma.allDebridCast.groupBy({
			by: ['size'],
			where,
			orderBy: {
				size: 'desc',
			},
			take: limit,
		});

		const otherCastItems = (
			await Promise.all(
				sizeGroups.map((group) =>
					this.prisma.allDebridCast.findFirst({
						where: { ...where, size: group.size },
						select: {
							url: true,
							link: true,
							size: true,
							hash: true,
							magnetId: true,
							fileIndex: true,
						},
					})
				)
			)
		).filter((item): item is NonNullable<typeof item> => item !== null);

		const castStreams = otherCastItems
			.filter(
				(
					item
				): item is {
					url: string;
					link: string;
					size: bigint;
					hash: string;
					magnetId: number | null;
					fileIndex: number | null;
				} => item.link !== null
			)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
				filename: item.url.split('/').pop() || 'Unknown',
				hash: item.hash,
				magnetId: item.magnetId,
				fileIndex: item.fileIndex,
			}));

		console.log('[AllDebridCastService] Stream sources breakdown:', {
			imdbId,
			total: castStreams.length,
			fromCast: castStreams.length,
		});

		return castStreams;
	}
}
