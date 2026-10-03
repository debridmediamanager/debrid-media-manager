import { isRdBlockedName } from './deInfringe';

/**
 * Whether Real-Debrid refuses this name: the torrent's own name when it is
 * added, a file's name when its link is unrestricted. One rule, measured
 * against the live service and kept in `deInfringe.ts`; this used to carry its
 * own case-insensitive copy of the pre-October-2026 list, which hid WEBRip,
 * BDRip, BluRay.x264 and `WEB.h264` releases RD takes.
 */
export function isRdBlockedFilename(filename: string): boolean {
	return isRdBlockedName(filename);
}
