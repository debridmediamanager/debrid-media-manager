import { type DebridLinkTorrent, getSeedboxTorrent, isDlFinished } from '@/services/debridLink';
import { recordDlAvailability, removeAvailabilityDl } from './availability';
import { generateTokenAndHash } from './token';

/** Whole on Debrid-Link: the status says finished, or every byte is in. */
export const dlWhole = (t: Pick<DebridLinkTorrent, 'status' | 'downloadPercent'>) =>
	isDlFinished(t.status) || t.downloadPercent >= 100;

/**
 * What an add told about Debrid-Link's cache, shared with everyone: Debrid-Link retired its
 * cache check, so an add is the only answer it gives. A torrent that came back whole is
 * recorded (a ZIP-listed one is fetched on its own for its files first); one DMM had shown
 * as cached that came back downloading is forgotten.
 */
export async function shareDlAnswer(
	dlKey: string,
	imdbId: string,
	hash: string,
	raw: DebridLinkTorrent,
	listedCached: boolean,
	deps = { getSeedboxTorrent, recordDlAvailability, removeAvailabilityDl, generateTokenAndHash }
): Promise<void> {
	if (dlWhole(raw)) {
		const full = raw.isZip ? await deps.getSeedboxTorrent(dlKey, raw.id) : raw;
		if (full) await deps.recordDlAvailability(imdbId, hash, full.name, full.files);
	} else if (listedCached) {
		const [key, solution] = await deps.generateTokenAndHash();
		await deps.removeAvailabilityDl(key, solution, hash, 'Debrid-Link add did not finish');
	}
}
