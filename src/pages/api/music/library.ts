import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

export interface MusicTrack {
	id: string;
	hash: string;
	fileId: number;
	link: string;
	path: string;
	bytes: number;
	trackNumber: number | null;
	filename: string;
}

export interface MusicAlbum {
	hash: string;
	mbid: string;
	artist: string;
	album: string;
	year: number | null;
	coverUrl: string | null;
	tracks: MusicTrack[];
	totalBytes: number;
	trackCount: number;
}

export interface MusicLibraryResponse {
	albums: MusicAlbum[];
	totalAlbums: number;
	totalTracks: number;
	page?: number;
	limit?: number;
	hasMore?: boolean;
	nextPage?: number | null;
}

type MusicSortOption = 'recent' | 'name' | 'artist' | 'year';

const audioExtensions = [
	'.flac',
	'.mp3',
	'.m4a',
	'.aac',
	'.ogg',
	'.opus',
	'.wav',
	'.wma',
	'.alac',
	'.ape',
	'.wv',
	'.dsf',
	'.dff',
];

const nonAudioExtensions = [
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.txt',
	'.nfo',
	'.cue',
	'.log',
	'.m3u',
	'.pdf',
	'.md5',
	'.sfv',
];

// Extract filename from path
function getFilename(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1] || path;
}

// Extract track number from filename
function extractTrackNumber(filename: string): number | null {
	// Try various patterns: "01 - Song.flac", "01. Song.flac", "Track 01.flac"
	const patterns = [
		/^(\d{1,3})\s*[-_.]\s*/,
		/^track\s*(\d{1,3})/i,
		/^\[(\d{1,3})\]/,
		/^(\d{1,3})\)/,
	];

	for (const pattern of patterns) {
		const match = filename.match(pattern);
		if (match) {
			return parseInt(match[1], 10);
		}
	}
	return null;
}

function isAudioPath(path: string): boolean {
	const lowerPath = path.toLowerCase();
	const lastDot = lowerPath.lastIndexOf('.');

	// If no extension, include it (might be audio)
	if (lastDot < 0) return true;

	const ext = lowerPath.slice(lastDot);

	// Exclude known non-audio files
	if (nonAudioExtensions.includes(ext)) return false;

	// Include known audio files and unknown extensions that are not explicitly excluded
	return audioExtensions.includes(ext) || !nonAudioExtensions.includes(ext);
}

function getStringQuery(value: string | string[] | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function getPositiveInt(value: string | string[] | undefined, fallback: number): number {
	const rawValue = getStringQuery(value);
	const parsed = rawValue ? parseInt(rawValue, 10) : NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getSortOption(value: string | string[] | undefined): MusicSortOption {
	const sortBy = getStringQuery(value);
	return sortBy === 'name' || sortBy === 'artist' || sortBy === 'year' ? sortBy : 'recent';
}

function sortAlbums(albums: MusicAlbum[], sortBy: MusicSortOption): MusicAlbum[] {
	switch (sortBy) {
		case 'name':
			return [...albums].sort((a, b) => a.album.localeCompare(b.album));
		case 'artist':
			return [...albums].sort((a, b) => a.artist.localeCompare(b.artist));
		case 'year':
			return [...albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
		case 'recent':
		default:
			return albums;
	}
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<MusicLibraryResponse | { error: string }>
) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const includeTracks = req.query.summary !== '1';
		const hash = typeof req.query.hash === 'string' ? req.query.hash : undefined;
		const page = getPositiveInt(req.query.page, 1);
		const limit = Math.min(getPositiveInt(req.query.limit, 48), 96);
		const search = getStringQuery(req.query.search)?.trim().toLowerCase() ?? '';
		const sortBy = getSortOption(req.query.sortBy);

		if (!includeTracks && !hash && !search && sortBy === 'recent') {
			const take = limit * 2;
			const skip = (page - 1) * limit;
			const [availableMusic, musicCounts] = await Promise.all([
				prisma.availableMusic.findMany({
					include: {
						_count: {
							select: {
								files: true,
							},
						},
					},
					orderBy: {
						ended: 'desc',
					},
					skip,
					take,
				}),
				prisma.availableMusic.findMany({
					select: {
						mbid: true,
						_count: {
							select: {
								files: true,
							},
						},
					},
				}),
			]);
			const countByMbid = new Map<string, number>();
			for (const music of musicCounts) {
				const fileCount = (music as any)._count?.files ?? 0;
				const existing = countByMbid.get(music.mbid) ?? 0;
				if (fileCount > existing) countByMbid.set(music.mbid, fileCount);
			}
			const totalAlbums = countByMbid.size;
			const totalTracks = Array.from(countByMbid.values()).reduce(
				(sum, count) => sum + count,
				0
			);

			const mbids = [...new Set(availableMusic.map((m) => m.mbid))];
			const metadata = await prisma.musicMetadata.findMany({
				where: {
					mbid: {
						in: mbids,
					},
				},
			});
			const metadataMap = new Map(metadata.map((m) => [m.mbid, m]));
			const albumsByMbid = new Map<string, MusicAlbum>();

			for (const music of availableMusic) {
				const meta = metadataMap.get(music.mbid);
				const album: MusicAlbum = {
					hash: music.hash,
					mbid: music.mbid,
					artist: meta?.artist ?? 'Unknown Artist',
					album: meta?.album ?? music.filename,
					year: meta?.year ?? null,
					coverUrl: meta?.coverUrl ?? null,
					tracks: [],
					totalBytes: Number(music.bytes),
					trackCount: (music as any)._count?.files ?? 0,
				};
				const existing = albumsByMbid.get(album.mbid);
				if (!existing || album.trackCount > existing.trackCount) {
					albumsByMbid.set(album.mbid, album);
				}
			}

			const albums = Array.from(albumsByMbid.values())
				.filter((album) => album.trackCount > 0)
				.slice(0, limit);
			const hasMore = skip + limit < musicCounts.length;

			return res.status(200).json({
				albums,
				totalAlbums,
				totalTracks,
				page,
				limit,
				hasMore,
				nextPage: hasMore ? page + 1 : null,
			});
		}

		// Get all available music albums with their files and metadata
		const availableMusic = await prisma.availableMusic.findMany({
			where: hash ? { hash } : undefined,
			include: includeTracks
				? {
						files: {
							orderBy: {
								trackNumber: 'asc',
							},
						},
					}
				: {
						_count: {
							select: {
								files: true,
							},
						},
					},
			orderBy: {
				ended: 'desc',
			},
		});

		// Get all unique MBIDs
		const mbids = [...new Set(availableMusic.map((m) => m.mbid))];

		// Fetch metadata for all albums
		const metadata = await prisma.musicMetadata.findMany({
			where: {
				mbid: {
					in: mbids,
				},
			},
		});

		// Create a map for quick lookup
		const metadataMap = new Map(metadata.map((m) => [m.mbid, m]));

		// Transform to response format
		const albums: MusicAlbum[] = availableMusic.map((music) => {
			const meta = metadataMap.get(music.mbid);
			const files = includeTracks ? ((music as any).files ?? []) : [];

			// Filter only audio files (include common audio extensions)
			const audioFiles = includeTracks ? files.filter((f: any) => isAudioPath(f.path)) : [];

			// Sort by track number, then filename
			const sortedTracks = audioFiles.sort((a: any, b: any) => {
				const trackA = a.trackNumber ?? extractTrackNumber(getFilename(a.path)) ?? 999;
				const trackB = b.trackNumber ?? extractTrackNumber(getFilename(b.path)) ?? 999;
				if (trackA !== trackB) return trackA - trackB;
				return getFilename(a.path).localeCompare(getFilename(b.path));
			});
			const trackCount = includeTracks
				? sortedTracks.length
				: ((music as any)._count?.files ?? 0);

			return {
				hash: music.hash,
				mbid: music.mbid,
				artist: meta?.artist ?? 'Unknown Artist',
				album: meta?.album ?? music.filename,
				year: meta?.year ?? null,
				coverUrl: meta?.coverUrl ?? null,
				tracks: includeTracks
					? sortedTracks.map((file: any, index: number) => ({
							id: `${music.hash}-${file.file_id}`,
							hash: music.hash,
							fileId: file.file_id,
							link: file.link,
							path: file.path,
							bytes: Number(file.bytes),
							trackNumber:
								file.trackNumber ??
								extractTrackNumber(getFilename(file.path)) ??
								index + 1,
							filename: getFilename(file.path),
						}))
					: [],
				totalBytes: Number(music.bytes),
				trackCount,
			};
		});

		// Filter out albums with no audio tracks
		const albumsWithTracksAll = albums.filter((a) => a.trackCount > 0);

		// Deduplicate by mbid — keep the version with the most tracks (most complete)
		const albumsByMbid = new Map<string, MusicAlbum>();
		for (const album of albumsWithTracksAll) {
			const existing = albumsByMbid.get(album.mbid);
			if (!existing || album.trackCount > existing.trackCount) {
				albumsByMbid.set(album.mbid, album);
			}
		}
		let albumsWithTracks = Array.from(albumsByMbid.values());

		if (search) {
			albumsWithTracks = albumsWithTracks.filter(
				(album) =>
					album.artist.toLowerCase().includes(search) ||
					album.album.toLowerCase().includes(search)
			);
		}

		albumsWithTracks = sortAlbums(albumsWithTracks, sortBy);
		const totalAlbums = albumsWithTracks.length;
		const totalTracks = albumsWithTracks.reduce((sum, a) => sum + a.trackCount, 0);
		const shouldPaginate = !includeTracks && !hash;
		const start = shouldPaginate ? (page - 1) * limit : 0;
		const end = shouldPaginate ? start + limit : albumsWithTracks.length;
		const pagedAlbums = albumsWithTracks.slice(start, end);
		const hasMore = shouldPaginate ? end < albumsWithTracks.length : false;

		const response: MusicLibraryResponse = {
			albums: pagedAlbums,
			totalAlbums,
			totalTracks,
			...(shouldPaginate
				? {
						page,
						limit,
						hasMore,
						nextPage: hasMore ? page + 1 : null,
					}
				: {}),
		};

		res.status(200).json(response);
	} catch (error) {
		console.error('Error fetching music library:', error);
		res.status(500).json({ error: 'Failed to fetch music library' });
	}
}
