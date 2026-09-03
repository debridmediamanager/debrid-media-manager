import { DatabaseClient } from './client';

export interface DebridLinkCastStream {
	url: string;
	size: number;
	filename: string;
	hash: string;
	path: string | null;
}

/**
 * Debrid-Link casts hold a hash, a file path and - uniquely in this family -
 * the file's own download URL.
 *
 * The hash is the address, for the same reason it is everywhere else:
 * `POST /seedbox/add` is idempotent by hash and the torrent id it returns is
 * *stable* (a bare-hash add, a magnet add, a duplicate add and a re-add after
 * removal all answered with the same id), so the viewer resolves the release
 * with their own credential at play time and nothing stored here can rot.
 *
 * `downloadUrl` is the deliberate extra, and it is deliberately not exposed by
 * any read on this class except `getStoredDownloadUrl`. A Debrid-Link URL has
 * no token, no signature, no timestamp and no user id in it - the torrent id is
 * the whole capability - it serves any IP, and it keeps serving after the
 * torrent is deleted. So one stored here is a genuine fallback for a viewer
 * whose own credential cannot resolve the hash (daily 50-torrent quota spent,
 * an endpoint inside its hour-long `floodDetected` lockout, a dead token) and,
 * in the same breath, an irrevocable capability to the content. It never
 * reaches a log, a client or the `links` listing.
 */
export class DebridLinkCastService extends DatabaseClient {
	public async saveCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean,
		// Last, so the signature still lines up with the sibling services. Only a
		// device-flow login has one; a pasted API token has nothing to refresh.
		refreshToken?: string | null
	) {
		return this.prisma.debridLinkCastProfile.upsert({
			where: { userId },
			update: {
				apiKey,
				// `undefined` leaves whatever is stored alone, so a browser that
				// only holds a pasted token does not wipe a refresh token an
				// earlier device-flow enrolment saved.
				...(refreshToken !== undefined && { refreshToken }),
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
				updatedAt: new Date(),
			},
			create: {
				userId,
				apiKey,
				refreshToken: refreshToken ?? null,
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
	 * user id the client already holds. Never touches the credential, so callers
	 * do not need it in hand and no Debrid-Link call is required to resync
	 * settings - which matters more here than elsewhere, because a wasted call
	 * is a step towards an hour-long endpoint lockout.
	 */
	public async updateCastSettings(
		userId: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	): Promise<boolean> {
		const { count } = await this.prisma.debridLinkCastProfile.updateMany({
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
		refreshToken?: string | null;
		movieMaxSize: number;
		episodeMaxSize: number;
		otherStreamsLimit?: number;
		hideCastOption?: boolean;
	} | null> {
		return this.prisma.debridLinkCastProfile.findUnique({
			where: { userId },
			select: {
				apiKey: true,
				refreshToken: true,
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
		path?: string,
		downloadUrl?: string
	): Promise<void> {
		await this.prisma.debridLinkCast.upsert({
			where: { imdbId_userId_hash: { imdbId, userId, hash } },
			update: {
				imdbId,
				url: filename,
				size: BigInt(fileSize),
				path,
				// Left alone when the resolve produced none, so a re-cast that
				// could not reach Debrid-Link does not throw away a working
				// fallback URL an earlier one stored.
				...(downloadUrl !== undefined && { downloadUrl }),
			},
			create: {
				imdbId,
				userId,
				hash,
				url: filename,
				size: BigInt(fileSize),
				path,
				downloadUrl: downloadUrl ?? null,
			},
		});
	}

	public async fetchCastedMovies(userId: string): Promise<string[]> {
		const movies = await this.prisma.debridLinkCast.findMany({
			where: { userId, imdbId: { not: { contains: ':' } } },
			orderBy: { updatedAt: 'desc' },
			distinct: ['imdbId'],
			select: { imdbId: true },
		});
		return movies.map((movie) => movie.imdbId);
	}

	public async fetchCastedShows(userId: string): Promise<string[]> {
		const shows = await this.prisma.debridLinkCast.findMany({
			where: { userId, imdbId: { contains: ':' } },
			orderBy: { updatedAt: 'desc' },
			select: { imdbId: true },
		});
		return shows
			.map((show) => show.imdbId.split(':')[0])
			.filter((value, index, self) => self.indexOf(value) === index);
	}

	/**
	 * The manage page's listing. `url` here is the *filename*, not the stored
	 * capability - `downloadUrl` is deliberately absent from the select list so
	 * nothing that reaches a browser carries a permanent unauthenticated link.
	 */
	public async fetchAllCastedLinks(
		userId: string
	): Promise<{ imdbId: string; url: string; hash: string; size: number; updatedAt: Date }[]> {
		const castItems = await this.prisma.debridLinkCast.findMany({
			where: { userId },
			select: { imdbId: true, url: true, hash: true, size: true, updatedAt: true },
			orderBy: { updatedAt: 'desc' },
		});
		return castItems.map((item) => ({ ...item, size: Number(item.size) }));
	}

	// Returns false when there was no matching row, so callers can answer 404
	// instead of reporting a server error for something that isn't there.
	public async deleteCastedLink(imdbId: string, userId: string, hash: string): Promise<boolean> {
		const { count } = await this.prisma.debridLinkCast.deleteMany({
			where: { imdbId, userId, hash },
		});
		return count > 0;
	}

	public async getUserCastStreams(
		imdbId: string,
		userId: string,
		limit: number = 5
	): Promise<DebridLinkCastStream[]> {
		const castItems = await this.prisma.debridLinkCast.findMany({
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
	 * Unbounded by age, like the Premiumize and Offcloud pools: there is no
	 * stored link here that rots. Unlike them there is also no batch cache probe
	 * to filter with - Debrid-Link retired `/seedbox/cached` and put nothing in
	 * its place - so the stream route offers these unverified and the play route
	 * reports the truth, which for Debrid-Link is a real answer rather than a
	 * guess: the add either comes back finished or says how far along it is.
	 */
	public async getOtherStreams(
		imdbId: string,
		userId: string,
		limit: number = 5,
		maxSize?: number
	): Promise<DebridLinkCastStream[]> {
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
		const sizeGroups = await this.prisma.debridLinkCast.groupBy({
			by: ['size'],
			where,
			orderBy: { size: 'desc' },
			take: limit,
		});

		const rows = (
			await Promise.all(
				sizeGroups.map((group) =>
					this.prisma.debridLinkCast.findFirst({
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

	/**
	 * The stored keyless URL for a cast of this hash, if anyone has one.
	 *
	 * The play route's last resort, and the only read that returns the column.
	 * Not scoped to a user on purpose: the URL is not account-scoped either -
	 * anyone holding it can fetch the bytes - so refusing to serve one that was
	 * written by a different caster would buy no privacy and would only break
	 * playback of an "other" stream. An exact path match wins so a season pack
	 * hands back the right episode; a hash-only row is the fallback for a cast
	 * that stored no path.
	 */
	public async getStoredDownloadUrl(hash: string, path?: string | null): Promise<string | null> {
		if (path) {
			const exact = await this.prisma.debridLinkCast.findFirst({
				where: { hash, path, downloadUrl: { not: null } },
				orderBy: { updatedAt: 'desc' },
				select: { downloadUrl: true },
			});
			if (exact?.downloadUrl) return exact.downloadUrl;
			// Without a path match there is nothing safe to serve: handing back
			// some other file of the release would play the wrong episode.
			return null;
		}

		const any = await this.prisma.debridLinkCast.findFirst({
			where: { hash, downloadUrl: { not: null } },
			orderBy: { updatedAt: 'desc' },
			select: { downloadUrl: true },
		});
		return any?.downloadUrl ?? null;
	}
}
