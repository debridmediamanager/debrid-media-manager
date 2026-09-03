import { DL_STATUS, isDlFinished } from '@/services/debridLink';
import { UserTorrentStatus } from '@/torrent/userTorrent';

/**
 * Debrid-Link's torrent status, in the words the library shows.
 *
 * **The status is bit-flag-ish and `100` is not one of the flags.** The
 * documented enum is 0 paused / 1 queued / 2 verification / 4 downloading /
 * 8 seeding / 100 finished, and the vendor's own sample carries `status: 6` -
 * VERIFICATION|DOWNLOADING, which equals no single member. So completion is a
 * threshold (`>= 100`, via `isDlFinished`) and every lower state is tested as a
 * *flag*, never by equality. An equality ladder would fall through `6` to the
 * default branch and label an actively downloading torrent unknown.
 *
 * The flags are read most-advanced first, so a combined value reports the state
 * the user cares about: `6` is "Downloading", not "Verifying".
 */

/** What `error`/`errorString` collapse to when the vendor sends no text. */
export const DL_ERROR_STATUS = 'error';

type DebridLinkStatusSource = {
	status: number;
	downloadPercent?: number;
	/** Rides on every torrent object; `0`/`""` when healthy. Not in the docs. */
	error?: number;
	errorString?: string;
};

const hasDlError = (torrent: Pick<DebridLinkStatusSource, 'error' | 'errorString'>): boolean =>
	(torrent.error ?? 0) !== 0 || (torrent.errorString ?? '').trim().length > 0;

/**
 * What a library row stores in `serviceStatus`.
 *
 * A healthy torrent stores the raw number as a string, because that is the only
 * lossless form of a flag combination. An unhealthy one stores the vendor's own
 * `errorString` instead - it is the single most useful thing to show a user, and
 * the numeric status of a failed torrent tells them nothing they can act on.
 * `DL_ERROR_STATUS` is the fallback for an error with no message.
 */
export const getDebridLinkServiceStatus = (torrent: DebridLinkStatusSource): string => {
	if (!hasDlError(torrent)) return `${torrent.status}`;
	const message = (torrent.errorString ?? '').trim();
	return message.length > 0 ? message : DL_ERROR_STATUS;
};

/**
 * Display text for whatever `getDebridLinkServiceStatus` stored.
 *
 * A value that is not a number is an error message the vendor wrote, so it is
 * passed straight through rather than flattened to "Error" - the same way the
 * Offcloud mapping passes an unrecognised status through instead of blanking
 * the cell.
 */
export const getDebridLinkStatusText = (serviceStatus: string): string => {
	const raw = (serviceStatus ?? '').trim();
	if (raw === DL_ERROR_STATUS) return 'Error';

	const status = Number(raw);
	if (raw === '' || !Number.isFinite(status)) return serviceStatus;

	// `>=`, never `===`: only FINISHED sits above the flag range.
	if (isDlFinished(status)) return 'Finished';
	if (status & DL_STATUS.SEEDING) return 'Seeding';
	if (status & DL_STATUS.DOWNLOADING) return 'Downloading';
	if (status & DL_STATUS.VERIFICATION) return 'Verifying';
	if (status & DL_STATUS.QUEUED) return 'Queued';
	if (status === DL_STATUS.PAUSED) return 'Paused';
	// A flag Debrid-Link has not documented yet: show the number rather than
	// inventing a label for it.
	return `Status ${status}`;
};

/**
 * The same status as a library status and a progress percentage.
 *
 * `downloadPercent` is the completion figure, **not** the `downloaded` boolean -
 * that one tracks whether the *user* has fetched the file, for the webapp's
 * "hide old links" feature, and reads `true` on things that never finished.
 *
 * A seeding torrent is finished by definition: it can only seed what it already
 * holds, even though `8` sits below the `100` threshold.
 */
export const getDebridLinkUserTorrentStatus = (
	torrent: DebridLinkStatusSource
): [UserTorrentStatus, number] => {
	const percent = torrent.downloadPercent ?? 0;
	if (hasDlError(torrent)) return [UserTorrentStatus.error, percent];
	if (isDlFinished(torrent.status)) return [UserTorrentStatus.finished, 100];
	if (torrent.status & DL_STATUS.SEEDING) return [UserTorrentStatus.finished, 100];
	if (torrent.status & (DL_STATUS.DOWNLOADING | DL_STATUS.VERIFICATION)) {
		return [UserTorrentStatus.downloading, percent];
	}
	// Queued and paused are both "nothing is moving"; DMM has no paused state of
	// its own, and `waiting` is what every other service's equivalent maps to.
	return [UserTorrentStatus.waiting, percent];
};
