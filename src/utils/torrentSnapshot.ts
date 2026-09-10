import type { MediaInfoResponse } from '@/components/showInfo/types';
import * as v from '@badrap/valita';
import type { Prisma } from '@prisma/client';

// zurg posts a snapshot of each release it has analyzed, and the Stremio addons
// and the media info panel read the probe back out. Anyone can post one, so the
// shape is checked the way zurgtorrent-worker checked it before it forwarded a
// snapshot here, and only the fields toStoredSnapshot names are kept. Two
// changes from the worker: Version is any release number rather than 0.10.0
// alone, and Unfixable may be missing because zurg strips it before sending.

const Tags = v.object({}).rest(v.string()).nullable();

const Stream = v
	.object({
		index: v.number(),
		codec_name: v.string(),
		bit_rate: v.string(),
		tags: Tags,
	})
	.rest(v.unknown());

const Format = v
	.object({
		filename: v.string(),
		nb_streams: v.number(),
		nb_programs: v.number(),
		format_name: v.string(),
		start_time: v.string(),
		duration: v.string(),
		size: v.string(),
		bit_rate: v.string(),
		probe_score: v.number(),
		tags: Tags,
	})
	.rest(v.unknown());

const MediaInfo = v.object({ streams: v.array(Stream), format: Format }).rest(v.unknown());

const SnapshotFile = v
	.object({
		State: v.literal('ok_file'),
		id: v.number(),
		path: v.string(),
		bytes: v.number(),
		selected: v.number(),
		Link: v.string().optional(),
		Ended: v.string(),
		MediaInfo,
	})
	.rest(v.unknown());

const ADDED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?$/;

export const TorrentSnapshot = v
	.object({
		Name: v.string(),
		OriginalName: v.string(),
		Hash: v
			.string()
			.assert((hash) => /^[a-fA-F0-9]{40}$/.test(hash), 'Hash is not an infohash'),
		Added: v.string().assert((added) => ADDED.test(added), 'Invalid format for "Added"'),
		IMDBID: v.string().optional(),
		SelectedFiles: v
			.object({})
			.rest(SnapshotFile)
			.assert((files) => Object.keys(files).length > 0, 'SelectedFiles is empty'),
		Unfixable: v.literal('').optional(),
		State: v.literal('ok_torrent'),
		Version: v.string().assert((version) => /^\d+\.\d+\.\d+$/.test(version), 'Invalid Version'),
	})
	.rest(v.unknown());

export type TorrentSnapshot = v.Infer<typeof TorrentSnapshot>;

type PublicMediaInfo = MediaInfoResponse['SelectedFiles'][string]['MediaInfo'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ffprobe records the address it read from, and zurg hands it the account's
// unrestricted download link.
function withoutProbeSource(mediaInfo: Record<string, unknown>): Record<string, unknown> {
	if (!isRecord(mediaInfo.format)) return mediaInfo;
	const format = { ...mediaInfo.format };
	delete format.filename;
	return { ...mediaInfo, format };
}

// toStoredSnapshot keeps the release's identity and each file's probe. Links,
// torrent ids and Plex keys belong to the account that posted and are dropped.
export function toStoredSnapshot(snapshot: TorrentSnapshot) {
	const files: Record<
		string,
		{ path: string; bytes: number; MediaInfo: Prisma.InputJsonObject }
	> = {};
	for (const [key, file] of Object.entries(snapshot.SelectedFiles)) {
		files[key] = {
			path: file.path,
			bytes: file.bytes,
			// A probe is parsed JSON, so it is stored as it arrived.
			MediaInfo: withoutProbeSource(file.MediaInfo) as Prisma.InputJsonObject,
		};
	}
	return {
		Name: snapshot.Name,
		OriginalName: snapshot.OriginalName,
		Hash: snapshot.Hash.toLowerCase(),
		Added: snapshot.Added,
		...(snapshot.IMDBID ? { IMDBID: snapshot.IMDBID } : {}),
		State: snapshot.State,
		Version: snapshot.Version,
		SelectedFiles: files,
	};
}

// publicMediaInfo is what the public media info route may show of a stored
// snapshot. Rows stored before the allowlist still carry each file's link and
// the download address, so the answer is rebuilt from the probe alone.
export function publicMediaInfo(payload: unknown): MediaInfoResponse | null {
	if (!isRecord(payload)) return null;

	const files: MediaInfoResponse['SelectedFiles'] = {};
	const selectedFiles = payload.SelectedFiles ?? payload.selectedFiles;
	if (isRecord(selectedFiles)) {
		for (const [key, entry] of Object.entries(selectedFiles)) {
			if (!isRecord(entry)) continue;
			const mediaInfo = entry.MediaInfo ?? entry.mediaInfo;
			if (isRecord(mediaInfo)) {
				files[key] = { MediaInfo: withoutProbeSource(mediaInfo) as PublicMediaInfo };
			}
		}
	}
	if (Object.keys(files).length > 0) {
		return { SelectedFiles: files };
	}

	const mediaInfo = payload.MediaInfo ?? payload.mediaInfo;
	if (isRecord(mediaInfo)) {
		return {
			SelectedFiles: {
				default: { MediaInfo: withoutProbeSource(mediaInfo) as PublicMediaInfo },
			},
		};
	}
	return null;
}
