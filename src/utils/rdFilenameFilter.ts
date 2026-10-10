import { isRdBlockedName } from './deInfringe';

/**
 * Whether Real-Debrid refuses this name: the torrent's own name when it is
 * added, a file's name when its link is unrestricted. One rule, measured
 * against the live service and kept in `deInfringe.ts`; this used to carry its
 * own copy of the list, which went stale when RD changed it.
 */
export function isRdBlockedFilename(filename: string): boolean {
	return isRdBlockedName(filename);
}
