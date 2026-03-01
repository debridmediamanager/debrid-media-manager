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
}

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

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<MusicLibraryResponse | { error: string }>
) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		// Get all available music albums with their files and metadata
		const availableMusic = await prisma.availableMusic.findMany({
			include: {
				files: {
					orderBy: {
						trackNumber: 'asc',
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

			// Filter only audio files (include common audio extensions)
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

			const audioFiles = music.files.filter((f) => {
				const path = f.path.toLowerCase();
				const lastDot = path.lastIndexOf('.');

				// If no extension, include it (might be audio)
				if (lastDot < 0) return true;

				const ext = path.slice(lastDot);

				// Exclude known non-audio files
				if (nonAudioExtensions.includes(ext)) return false;

				// Include if it's a known audio extension OR if it's not a known non-audio extension
				return audioExtensions.includes(ext) || !nonAudioExtensions.includes(ext);
			});

			// Sort by track number, then filename
			const sortedTracks = audioFiles.sort((a, b) => {
				const trackA = a.trackNumber ?? extractTrackNumber(getFilename(a.path)) ?? 999;
				const trackB = b.trackNumber ?? extractTrackNumber(getFilename(b.path)) ?? 999;
				if (trackA !== trackB) return trackA - trackB;
				return getFilename(a.path).localeCompare(getFilename(b.path));
			});

			return {
				hash: music.hash,
				mbid: music.mbid,
				artist: meta?.artist ?? 'Unknown Artist',
				album: meta?.album ?? music.filename,
				year: meta?.year ?? null,
				coverUrl: meta?.coverUrl ?? null,
				tracks: sortedTracks.map((file, index) => ({
					id: `${music.hash}-${file.file_id}`,
					hash: music.hash,
					fileId: file.file_id,
					link: file.link,
					path: file.path,
					bytes: Number(file.bytes),
					trackNumber:
						file.trackNumber ?? extractTrackNumber(getFilename(file.path)) ?? index + 1,
					filename: getFilename(file.path),
				})),
				totalBytes: Number(music.bytes),
				trackCount: sortedTracks.length,
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
		const albumsWithTracks = Array.from(albumsByMbid.values());

		const response: MusicLibraryResponse = {
			albums: albumsWithTracks,
			totalAlbums: albumsWithTracks.length,
			totalTracks: albumsWithTracks.reduce((sum, a) => sum + a.trackCount, 0),
		};

		res.status(200).json(response);
	} catch (error) {
		console.error('Error fetching music library:', error);
		res.status(500).json({ error: 'Failed to fetch music library' });
	}
}
