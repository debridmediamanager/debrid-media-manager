import { UserTorrentStatus } from '@/torrent/userTorrent';

/**
 * Maps Offcloud cloud statuses to display text.
 *
 * The enum is `created | queued | downloading | downloaded | error | canceled`
 * (recovered from StremThru, `created` and `downloaded` seen live). `created`
 * is Offcloud's accepted-but-not-started state, which is the same thing to a
 * reader as `queued` - and the state a zombie sits in forever, because Offcloud
 * accepts a garbage magnet with a 200 and never finishes or fails it.
 *
 * Offcloud spells the last one `canceled`; the UI says Cancelled, like the rest
 * of DMM.
 */
export function getOffcloudStatusText(status: string): string {
	switch (status?.toLowerCase()) {
		case 'created':
		case 'queued':
			return 'Queued';
		case 'downloading':
			return 'Downloading';
		case 'downloaded':
			return 'Finished';
		case 'error':
			return 'Error';
		case 'canceled':
			return 'Cancelled';
		default:
			return status;
	}
}

/**
 * The same enum as a library status and a progress percentage.
 *
 * Offcloud reports `progress` only on `cloud/status`, one item per call, and
 * never in the history listing a library row is built from - so progress here
 * is the coarse 0 or 100 the status implies, and the modal refines it for the
 * one row a user opens. A cancelled item is not an error the user can retry out
 * of, but it has no content behind it either, so it takes the error branch for
 * display purposes the way every other service's dead states do.
 */
export function getOffcloudUserTorrentStatus(status: string): [UserTorrentStatus, number] {
	switch (status?.toLowerCase()) {
		case 'created':
		case 'queued':
			return [UserTorrentStatus.waiting, 0];
		case 'downloading':
			return [UserTorrentStatus.downloading, 0];
		case 'downloaded':
			return [UserTorrentStatus.finished, 100];
		default:
			return [UserTorrentStatus.error, 0];
	}
}
