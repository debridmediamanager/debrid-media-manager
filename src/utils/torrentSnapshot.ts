import type { MediaInfoResponse } from '@/components/showInfo/types';

// zurg posts a snapshot of each release it has analyzed, and the media info
// panel reads the probe back out. Snapshots were stored whole, so a row carries
// each file's RD link and, inside the probe, the address ffprobe read from:
// the posting account's unrestricted download link.

type PublicMediaInfo = MediaInfoResponse['SelectedFiles'][string]['MediaInfo'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutProbeSource(mediaInfo: Record<string, unknown>): Record<string, unknown> {
	if (!isRecord(mediaInfo.format)) return mediaInfo;
	const format = { ...mediaInfo.format };
	delete format.filename;
	return { ...mediaInfo, format };
}

// publicMediaInfo is what the public media info route may show of a stored
// snapshot: the probe of each file and nothing else.
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
