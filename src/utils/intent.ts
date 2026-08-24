import { unlockLink } from '@/services/allDebrid';
import { directDownloadPremiumize } from '@/services/premiumize';
import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	unrestrictLink,
} from '@/services/realDebrid';
import { handleSelectFilesInRd } from './addMagnet';
import {
	getBiggestFileTorBoxStreamUrl,
	getFileByNameTorBoxStreamUrl,
	getOwnedTorBoxStreamUrl,
	getWebDownloadStreamUrlByHash,
} from './getTorBoxStreamUrl';

// 'tbw' is a TorBox web download, which lives in its own namespace with its own
// list and its own download-link endpoint — it cannot be resolved as a torrent.
export type WatchService = 'rd' | 'ad' | 'tb' | 'tbw' | 'pm';

export const isWatchService = (value: unknown): value is WatchService =>
	value === 'rd' || value === 'ad' || value === 'tb' || value === 'tbw' || value === 'pm';

const basename = (path: string) => path.split('/').pop() || path;

/**
 * Turns a direct, playable URL into whatever the chosen player expects.
 *
 * `fallbackUrl` is what an unrecognised `os` falls back to: Real-Debrid has a
 * streaming page to hand the browser, the other services have nothing but the
 * URL itself.
 */
export const buildPlayerIntent = (
	os: string,
	player: string,
	downloadUrl: string,
	fallbackUrl: string
): string => {
	if (os === 'android') {
		return `intent://${downloadUrl.replace('https://', '')}#Intent;type=video/any;scheme=https${
			player !== 'chooser' ? ';package=' + player : ''
		};end`;
	}
	if (os === 'ios' || os === 'mac') {
		return `${player}://${downloadUrl.replace('https://', '')}`;
	}
	if (os === 'ios2' || os === 'mac4') {
		return `${player}://x-callback-url/open?url=${downloadUrl}`;
	}
	if (os === 'mac2') {
		return `${player}://weblink?url=${downloadUrl}`;
	}
	if (os === 'mac3') {
		return `${player}://weblink?url=${downloadUrl}&new_window=1`;
	}
	if (os === 'windows') {
		return `${player}://${downloadUrl}`;
	}
	return fallbackUrl;
};

/**
 * Picks the link for the wanted file out of an RD torrent.
 *
 * `fileName` is preferred over `fileId` because a SearchResult's `files` array
 * is shared by all three services and whichever availability check ran last
 * wins — an RD file id, an AllDebrid positional index and a TorBox positional
 * index are all stored in the same `fileId` field and are not interchangeable.
 * The name survives that ambiguity; the id is only a fallback for callers that
 * still send one.
 */
export const pickRdLink = (
	torrentInfo: { files: { id: number; path: string; selected: number }[]; links: string[] },
	fileId: number,
	fileName?: string
): string | undefined => {
	const selected = torrentInfo.files.filter((f) => f.selected);

	let fileIdx = -1;
	if (fileName) {
		const target = basename(fileName).toLowerCase();
		fileIdx = selected.findIndex((f) => basename(f.path).toLowerCase() === target);
	}
	if (fileIdx < 0) {
		fileIdx = selected.findIndex((f) => f.id === fileId);
	}

	return torrentInfo.links[fileIdx] ?? torrentInfo.links[0];
};

// TorBox resolves entirely server-side: check cached, add (or reuse) the
// torrent, then ask for a download link.
const getTbInstantIntent = async (
	tbKey: string,
	hash: string,
	os: string,
	player: string,
	fileName?: string
): Promise<{ intent?: string; error?: string }> => {
	try {
		let streamUrl = '';
		let cachedPathError: unknown;
		// Watch is "play this now", not "add this to my library" - the Real-Debrid
		// path already adds and deletes around a single play, and this matches it.
		// The minted link outlives the library entry, so nothing is lost.
		const release = { releaseIfAdded: true };
		try {
			if (fileName) {
				try {
					[streamUrl] = await getFileByNameTorBoxStreamUrl(
						tbKey,
						hash,
						basename(fileName),
						release
					);
				} catch {
					// The name came from a different service's file listing, so
					// fall back to the biggest file rather than failing outright.
					streamUrl = '';
				}
			}
			if (!streamUrl) {
				[streamUrl] = await getBiggestFileTorBoxStreamUrl(tbKey, hash, release);
			}
		} catch (e) {
			// Both cached lookups check TorBox's global cache before the user's
			// own list, so a library entry whose cache entry has aged out lands
			// here even though the file is still streamable.
			cachedPathError = e;
		}

		if (!streamUrl) {
			streamUrl = await getOwnedTorBoxStreamUrl(tbKey, hash, fileName);
		}
		if (!streamUrl) {
			if (cachedPathError) throw cachedPathError;
			return { error: `No TorBox stream URL found for ${hash}` };
		}
		return { intent: buildPlayerIntent(os, player, streamUrl, streamUrl) };
	} catch (e: any) {
		return { error: `Failed to get TorBox stream: ${e.message || e}` };
	}
};

// TorBox web downloads only exist in the account that created them, so there is
// no cache to consult and nothing to re-add from a hash.
const getTbWebDownloadIntent = async (
	tbKey: string,
	hash: string,
	os: string,
	player: string,
	fileName?: string
): Promise<{ intent?: string; error?: string }> => {
	try {
		const streamUrl = await getWebDownloadStreamUrlByHash(tbKey, hash, fileName);
		if (!streamUrl) {
			return { error: `No TorBox web download stream URL found for ${hash}` };
		}
		return { intent: buildPlayerIntent(os, player, streamUrl, streamUrl) };
	} catch (e: any) {
		return { error: `Failed to get TorBox web download stream: ${e.message || e}` };
	}
};

/**
 * Premiumize resolves a hash to a playable URL in one stateless call: nothing is
 * added to the account, nothing has to be cleaned up afterwards, and the CDN
 * link it hands back needs no authentication and is not IP-bound. That makes it
 * the only one of the four that can be resolved entirely server-side without
 * touching the user's library.
 */
const getPmInstantIntent = async (
	pmKey: string,
	hash: string,
	os: string,
	player: string,
	fileName?: string
): Promise<{ intent?: string; error?: string }> => {
	try {
		const files = await directDownloadPremiumize(pmKey, hash);
		if (files.length === 0) {
			return { error: `No Premiumize files found for ${hash}` };
		}

		const target = basename(fileName || '').toLowerCase();
		const byName = target
			? files.find((file) => basename(file.path).toLowerCase() === target)
			: undefined;
		// `content` is ordered by Premiumize, and content[0] for a torrent is
		// whatever sorts first — a poster JPEG in the reference case — so the
		// fallback has to be the biggest file, never the first.
		const biggest = files.reduce((best, file) =>
			(file.size ?? 0) > (best.size ?? 0) ? file : best
		);
		const picked = byName ?? biggest;
		const streamUrl = picked.stream_link || picked.link;
		return { intent: buildPlayerIntent(os, player, streamUrl, streamUrl) };
	} catch (e: any) {
		return { error: `Failed to get Premiumize stream: ${e.message || e}` };
	}
};

const getRdInstantIntent = async (
	rdKey: string,
	hash: string,
	fileId: number,
	ipAddress: string,
	os: string,
	player: string,
	fileName?: string
): Promise<{ intent?: string; error?: string }> => {
	try {
		const id = await addHashAsMagnet(rdKey, hash, false);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, false);
			const torrentInfo = await getTorrentInfo(rdKey, id, false);
			if (torrentInfo.status !== 'downloaded') {
				await deleteTorrent(rdKey, id, false);
				return {
					error: `Torrent status is '${torrentInfo.status}', expected 'downloaded'`,
				};
			}

			const link = pickRdLink(torrentInfo, fileId, fileName);
			const resp = await unrestrictLink(rdKey, link!, ipAddress, false);
			await deleteTorrent(rdKey, id, false);
			return {
				intent: buildPlayerIntent(
					os,
					player,
					resp.download,
					'https://real-debrid.com/streaming-' + resp.id
				),
			};
		} catch (e: any) {
			await deleteTorrent(rdKey, id, false).catch(() => {});
			return { error: `Failed to process torrent: ${e.message || e}` };
		}
	} catch (e: any) {
		return { error: `Failed to add magnet: ${e.message || e}` };
	}
};

/**
 * Resolves a hash straight to a player intent.
 *
 * AllDebrid is deliberately absent: `magnet/upload` is refused from datacenter
 * IPs (NO_SERVER), so an AD magnet has to be prepared in the user's browser and
 * then handed to `getIntent` as an already-resolved link.
 */
export const getInstantIntent = async (
	key: string,
	hash: string,
	fileId: number,
	ipAddress: string,
	os: string,
	player: string,
	service: WatchService = 'rd',
	fileName?: string
): Promise<{ intent?: string; error?: string }> => {
	if (service === 'tb') {
		return getTbInstantIntent(key, hash, os, player, fileName);
	}
	if (service === 'tbw') {
		return getTbWebDownloadIntent(key, hash, os, player, fileName);
	}
	if (service === 'pm') {
		return getPmInstantIntent(key, hash, os, player, fileName);
	}
	if (service === 'ad') {
		return {
			error: 'AllDebrid magnets must be prepared in the browser; call /api/watch with a link',
		};
	}
	return getRdInstantIntent(key, hash, fileId, ipAddress, os, player, fileName);
};

/**
 * Resolves an already-known service link to a player intent.
 *
 * RD links are bound to the caller's IP, hence `ipAddress`; AllDebrid's unlocked
 * links are self-authenticating, so unlocking from the server is safe and the
 * resulting URL keeps working (and keeps honouring Range) even after the magnet
 * is deleted from the account.
 */
export const getIntent = async (
	key: string,
	link: string,
	ipAddress: string,
	os: string,
	player: string,
	service: WatchService = 'rd'
): Promise<{ intent?: string; error?: string }> => {
	if (service === 'tb' || service === 'tbw') {
		return { error: 'TorBox links are resolved by hash; call /api/watch/instant instead' };
	}
	if (service === 'pm') {
		// A Premiumize CDN link is already the playable URL: no auth, no
		// redemption step, and Range works. There is nothing to unrestrict.
		return { intent: buildPlayerIntent(os, player, link, link) };
	}
	if (service === 'ad') {
		try {
			const unlocked = await unlockLink(key, link);
			if (!unlocked?.link) {
				return { error: `Failed to unlock AllDebrid link: ${link}` };
			}
			return { intent: buildPlayerIntent(os, player, unlocked.link, unlocked.link) };
		} catch (e: any) {
			return { error: `Failed to unlock link: ${e.message || e}` };
		}
	}
	try {
		const resp = await unrestrictLink(key, link, ipAddress, false);
		return {
			intent: buildPlayerIntent(
				os,
				player,
				resp.download,
				'https://real-debrid.com/streaming-' + resp.id
			),
		};
	} catch (e: any) {
		return { error: `Failed to unrestrict link: ${e.message || e}` };
	}
};
