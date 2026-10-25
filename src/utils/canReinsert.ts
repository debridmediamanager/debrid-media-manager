import { UserTorrent } from '@/torrent/userTorrent';
import { isWebDownloadRowId } from './torboxWebDownload';

/** AllDebrid statusCode 5 and up are its failure states; `magnet/restart` refuses the rest. */
export const isAdMagnetFailed = (statusCode?: number) => (statusCode ?? 0) >= 5;

/**
 * Whether a library row has a reinsert behind it: Real-Debrid re-adds, TorBox
 * reannounces an active torrent and AllDebrid restarts a failed magnet.
 * TorBox answers a reannounce of any finished torrent (cached, completed or
 * stalled) with 500 DOWNLOAD_SERVER_ERROR. Premiumize, Offcloud and Debrid-Link
 * have no such operation.
 */
export function canReinsert(t: UserTorrent): boolean {
	if (t.id.startsWith('rd:')) return true;
	if (t.id.startsWith('tb:')) return !isWebDownloadRowId(t.id) && t.tbData?.active === true;
	if (t.id.startsWith('ad:')) return isAdMagnetFailed(t.adData?.statusCode);
	return false;
}

export const NOT_REINSERTABLE =
	'None of these can be reinserted: Premiumize, Offcloud and Debrid-Link have no reinsert, TorBox reannounces only active torrents, and AllDebrid restarts only failed ones.';
