import { UserTorrent } from '@/torrent/userTorrent';
import { isWebDownloadRowId } from './torboxWebDownload';

/** AllDebrid statusCode 5 and up are its failure states; `magnet/restart` refuses the rest. */
export const isAdMagnetFailed = (statusCode?: number) => (statusCode ?? 0) >= 5;

/**
 * Whether a library row has a reinsert behind it: Real-Debrid re-adds, TorBox
 * reannounces and AllDebrid restarts a failed magnet. Premiumize, Offcloud and
 * Debrid-Link have no such operation.
 */
export function canReinsert(t: UserTorrent): boolean {
	if (t.id.startsWith('rd:')) return true;
	if (t.id.startsWith('tb:')) return !isWebDownloadRowId(t.id);
	if (t.id.startsWith('ad:')) return isAdMagnetFailed(t.adData?.statusCode);
	return false;
}

export const NOT_REINSERTABLE =
	'None of these can be reinserted: Premiumize, Offcloud and Debrid-Link have no reinsert, and AllDebrid restarts only failed torrents.';
