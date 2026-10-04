import type { MediaInfoResponse } from '@/components/showInfo/types';
import * as v from '@badrap/valita';
import type { Prisma } from '@prisma/client';

// zurg posts a snapshot of each release it has analyzed, and the Stremio addons
// and the media info panel read the probe back out. Anyone can post one, so the
// shape is checked the way zurgtorrent-worker checked it before it forwarded a
// snapshot here, and only the fields toStoredSnapshot names are kept. Changes
// from the worker: Version is any release number rather than 0.10.0 alone,
// Unfixable may be missing because zurg strips it before sending, and a release
// is taken for whichever of its files were analyzed rather than refused unless
// all of them were (see isStorable).

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
		// zurg's own file state; only ok files are stored (isStorable).
		State: v.string(),
		id: v.number(),
		path: v.string(),
		bytes: v.number(),
		selected: v.number(),
		Link: v.string().optional(),
		Ended: v.string(),
		MediaInfo: MediaInfo.nullable().optional(),
	})
	.rest(v.unknown());

// The extensions zurg hands to ffprobe (IsVideoOrAudio in zurg's
// pkg/utils/playable.go). Only the refusal log uses them now, to tell a media
// file zurg has not analyzed from a sidecar it never will.
const PROBED_EXTENSIONS = new Set([
	'.avi',
	'.flv',
	'.m2ts',
	'.m4v',
	'.mk3d',
	'.mkv',
	'.mov',
	'.mp4',
	'.mpeg',
	'.mpg',
	'.ts',
	'.webm',
	'.wmv',
	'.mp3',
	'.m4a',
	'.m4b',
	'.flac',
]);

function isProbed(path: string): boolean {
	const dot = path.lastIndexOf('.');
	return dot > path.lastIndexOf('/') && PROBED_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

// isStorable says whether a file's probe is kept. zurg posts after every
// analysis pass with whatever that pass managed: an episode whose probe failed,
// one in its day of cooldown from an earlier failure, one the user deleted
// through the mount, all arrive without a probe beside episodes that have one.
// Refusing the release for them threw the probes it did carry away on every
// pass. zurg analyzes only ok files, so it never sends a probe on any other.
function isStorable<F extends { State: string; MediaInfo?: unknown }>(
	file: F
): file is F & { MediaInfo: NonNullable<F['MediaInfo']> } {
	return file.State === 'ok_file' && Boolean(file.MediaInfo);
}

// FileCounts is what each file of a posted release carried, for the logs: how
// many probes there were, how many media files had none, how many sidecars
// zurg never probes, and how many files were in each state other than ok.
export type FileCounts = { analyzed: number; not_analyzed: number; sidecar: number } & Record<
	string,
	number
>;

// zurg's file states all end in _file, which also keeps them apart from the
// three outcome names above.
const FILE_STATE = /^[a-z_]{1,32}_file$/;

// countFiles reads a body that may not have passed validation, so it checks
// every field it touches and buckets an unknown state rather than echo it.
export function countFiles(body: unknown): FileCounts | undefined {
	if (!isRecord(body) || !isRecord(body.SelectedFiles)) return undefined;
	const counts: FileCounts = { analyzed: 0, not_analyzed: 0, sidecar: 0 };
	for (const file of Object.values(body.SelectedFiles)) {
		if (!isRecord(file)) continue;
		let outcome: string;
		if (file.State !== 'ok_file') {
			outcome =
				typeof file.State === 'string' && FILE_STATE.test(file.State)
					? file.State
					: 'unknown_state';
		} else if (isRecord(file.MediaInfo)) {
			outcome = 'analyzed';
		} else if (typeof file.path === 'string' && isProbed(file.path)) {
			outcome = 'not_analyzed';
		} else {
			outcome = 'sidecar';
		}
		counts[outcome] = (counts[outcome] ?? 0) + 1;
	}
	return counts;
}

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
			.assert((files) => Object.values(files).some(isStorable), 'No file was analyzed'),
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

// toStoredSnapshot keeps the release's identity and each analyzed file's probe.
// Links, torrent ids and Plex keys belong to the account that posted and are
// dropped, and so are files that carry no probe or are not ok in zurg.
export function toStoredSnapshot(snapshot: TorrentSnapshot) {
	const files: Record<
		string,
		{ path: string; bytes: number; MediaInfo: Prisma.InputJsonObject }
	> = {};
	for (const [key, file] of Object.entries(snapshot.SelectedFiles)) {
		if (!isStorable(file)) continue;
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
