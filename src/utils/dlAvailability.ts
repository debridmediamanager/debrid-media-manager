import { type DebridLinkTorrent, isDlFinished } from '@/services/debridLink';
import { recordDlAvailability, removeAvailabilityDl } from './availability';
import { generateTokenAndHash } from './token';

/** Whole on Debrid-Link: the status says finished, or every byte is in. */
export const dlWhole = (t: Pick<DebridLinkTorrent, 'status' | 'downloadPercent'>) =>
	isDlFinished(t.status) || t.downloadPercent >= 100;

/**
 * What an add told about Debrid-Link's cache, shared with everyone: Debrid-Link retired its
 * cache check, so an add is the only answer it gives. A torrent that came back whole is
 * offered for the table, and one DMM had shown as cached that came back downloading is
 * reported; either way DMM asks Debrid-Link itself before it records or forgets anything.
 */
export async function shareDlAnswer(
	imdbId: string,
	hash: string,
	raw: DebridLinkTorrent,
	listedCached: boolean,
	deps = { recordDlAvailability, removeAvailabilityDl, generateTokenAndHash }
): Promise<void> {
	if (dlWhole(raw)) {
		await deps.recordDlAvailability(imdbId, hash);
	} else if (listedCached) {
		const [key, solution] = await deps.generateTokenAndHash();
		await deps.removeAvailabilityDl(key, solution, hash, 'Debrid-Link add did not finish');
	}
}
