import { unlockLink } from '@/services/allDebrid';
import {
	addSeedboxTorrent,
	isDlFinished,
	toMagnetUri as toDlMagnetUri,
} from '@/services/debridLink';
import {
	addOffcloudCloud,
	exploreOffcloudCloud,
	getOffcloudCacheInfo,
	getOffcloudCloudStatus,
	isValidBtih,
	joinExploreWithCacheInfo,
} from '@/services/offcloud';
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
export type WatchService = 'rd' | 'ad' | 'tb' | 'tbw' | 'pm' | 'oc' | 'dl';

export const isWatchService = (value: unknown): value is WatchService =>
	value === 'rd' ||
	value === 'ad' ||
	value === 'tb' ||
	value === 'tbw' ||
	value === 'pm' ||
	value === 'oc' ||
	value === 'dl';

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
		// Without a fallback, an intent Chrome declines to launch — the package
		// is not installed, or the navigation did not carry a user gesture —
		// goes nowhere at all and leaves the tab blank. The fallback turns that
		// dead end into the stream itself, playing in the browser.
		const parts = ['type=video/any', 'scheme=https'];
		if (player !== 'chooser') parts.push(`package=${player}`);
		parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
		return `intent://${downloadUrl.replace('https://', '')}#Intent;${parts.join(';')};end`;
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

/**
 * How long a freshly added Offcloud item is given to reach `downloaded` before
 * this gives up on it.
 *
 * Offcloud accepts a syntactically invalid magnet with a `200` and parks it in
 * `created` with `message: "Loading..."` **forever** — nothing upstream ever
 * fails it. `isValidBtih` refuses the shapes that are knowably bad, but a valid
 * hash for content nobody is seeding behaves the same way, so an unbounded poll
 * would hold a watch tab open indefinitely. Fifteen seconds is well past the
 * cached case (which finishes inside the add response, no poll at all) and short
 * enough that "it is downloading" arrives as an answer rather than a hang.
 */
const OC_STATUS_POLL_TIMEOUT_MS = 15_000;
const OC_STATUS_POLL_INTERVAL_MS = 1_500;

/**
 * Resolves an Offcloud hash to a playable URL.
 *
 * Unlike Premiumize's stateless `directdl`, Offcloud has no probe that returns
 * links: the item has to exist in the account before `/cloud/explore` will name
 * it. The add is idempotent while the item lives (the same magnet returns the
 * same `requestId`), so replaying a watch costs nothing, and a cached magnet
 * answers `downloaded` inside the add response — which is the whole path for
 * anything the availability sweep flagged.
 *
 * Explore returns a bare array of signed CDN URLs with no names and no sizes, so
 * the file listing comes from a second, non-destructive `/cache/info` call and
 * the two are paired on the filename that sits URL-encoded at the end of the CDN
 * path. The resulting URL is keyless, any-IP and honours Range, so it is handed
 * to the player as-is.
 */
const getOcInstantIntent = async (
	ocKey: string,
	hash: string,
	os: string,
	player: string,
	fileName?: string
): Promise<{ intent?: string; error?: string }> => {
	if (!isValidBtih(hash)) {
		// Offcloud would accept this and create a zombie; refuse it here.
		return { error: `"${hash}" is not a valid info hash` };
	}
	try {
		const added = await addOffcloudCloud(ocKey, hash);
		if (!added.requestId) {
			return { error: `Offcloud accepted ${hash} without a request id` };
		}

		let status = added.status;
		const deadline = Date.now() + OC_STATUS_POLL_TIMEOUT_MS;
		while (status !== 'downloaded' && Date.now() < deadline) {
			if (status === 'error' || status === 'canceled') {
				return { error: `Offcloud reported '${status}' for ${hash}` };
			}
			await new Promise((resolve) => setTimeout(resolve, OC_STATUS_POLL_INTERVAL_MS));
			status = (await getOffcloudCloudStatus(ocKey, added.requestId)).status;
		}
		if (status !== 'downloaded') {
			return {
				error: `Offcloud is still '${status}' after ${OC_STATUS_POLL_TIMEOUT_MS / 1000}s — try again once it finishes`,
			};
		}

		const [links, [info]] = await Promise.all([
			exploreOffcloudCloud(ocKey, added.requestId),
			// Non-destructive, and the only way to learn names and sizes: explore
			// hands back links and nothing else. A failure here is not fatal — the
			// join still yields decoded basenames off the URLs themselves.
			getOffcloudCacheInfo(ocKey, [hash]).catch(() => [null]),
		]);
		const files = joinExploreWithCacheInfo(links, info?.files ?? []);
		if (files.length === 0) {
			return { error: `No Offcloud files found for ${hash}` };
		}

		const target = basename(fileName || '').toLowerCase();
		const byName = target
			? files.find((file) => file.filename.toLowerCase() === target)
			: undefined;
		// Explore's order is Offcloud's, not "biggest first", so a first-file
		// fallback hands the user whatever sorts first — a poster or a sample.
		const biggest = files.reduce((best, file) =>
			(file.size ?? 0) > (best.size ?? 0) ? file : best
		);
		const picked = byName ?? biggest;
		return { intent: buildPlayerIntent(os, player, picked.link, picked.link) };
	} catch (e: any) {
		return { error: `Failed to get Offcloud stream: ${e.message || e}` };
	}
};

/**
 * Resolves a Debrid-Link hash to a playable URL.
 *
 * Debrid-Link has no cache probe at all — `/seedbox/cached` is disabled and
 * nothing replaced it — so the add *is* the probe, and there is no availability
 * flag anywhere in the app that could have gated this call. That is fine here:
 * the add is idempotent by hash and the torrent id is stable across duplicate
 * adds and even across remove-then-re-add, so replaying a watch costs one
 * request and creates nothing new.
 *
 * **The full magnet, never the bare hash.** A bare hash is only accepted when
 * the content is already cached, which would turn "play this" into a probe that
 * refuses everything else with `notAddTorrent`. Cached content answers
 * synchronously complete — `status: 100` with live URLs, ~150 ms — so the
 * happy path is still one request, and an uncached one honestly reports that it
 * is downloading rather than sitting in a poll.
 *
 * There is deliberately no poll here, unlike Offcloud's: a Debrid-Link add that
 * is not already finished is a real BitTorrent download, minutes long at best,
 * and holding a watch tab open for it teaches the user nothing they cannot read
 * off the library page.
 *
 * The URL that comes back is the whole capability — no token, no signature, no
 * IP binding — so it is handed to the player exactly as received and belongs
 * nowhere that logs URLs.
 */
const getDlInstantIntent = async (
	dlKey: string,
	hash: string,
	os: string,
	player: string,
	fileName?: string
): Promise<{ intent?: string; error?: string }> => {
	try {
		const torrent = await addSeedboxTorrent(dlKey, toDlMagnetUri(hash));

		// `>=`, never `=== 100`: the lower states are flags that combine and the
		// vendor's own sample carries `status: 6`.
		if (!isDlFinished(torrent.status)) {
			const percent = Math.floor(torrent.downloadPercent ?? 0);
			return {
				error: `Debrid-Link is still downloading this (${percent}%) — try again once it finishes`,
			};
		}

		const files = torrent.files ?? [];
		if (files.length === 0) {
			return { error: `No Debrid-Link files found for ${hash}` };
		}

		const target = basename(fileName || '').toLowerCase();
		const byName = target
			? files.find((file) => basename(file.name || '').toLowerCase() === target)
			: undefined;
		// The file list is the torrent's own order, so a first-file fallback hands
		// the user whatever the release happened to list first — a sample or a
		// poster. The biggest file is the one they meant.
		const biggest = files.reduce((best, file) =>
			(file.size ?? 0) > (best.size ?? 0) ? file : best
		);
		const picked = byName ?? biggest;
		if (!picked?.downloadUrl) {
			return { error: `Debrid-Link has no download URL for ${hash}` };
		}
		return { intent: buildPlayerIntent(os, player, picked.downloadUrl, picked.downloadUrl) };
	} catch (e: any) {
		return { error: `Failed to get Debrid-Link stream: ${e.message || e}` };
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
	if (service === 'oc') {
		return getOcInstantIntent(key, hash, os, player, fileName);
	}
	if (service === 'dl') {
		return getDlInstantIntent(key, hash, os, player, fileName);
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
	if (service === 'pm' || service === 'oc' || service === 'dl') {
		// A Premiumize CDN link is already the playable URL: no auth, no
		// redemption step, and Range works. There is nothing to unrestrict.
		// Offcloud's links are the same objects on the same CDN (energycdn),
		// measured keyless and any-IP the same way, so they take the same path.
		// Debrid-Link's go further still - the torrent id is the entire
		// capability, and the URL keeps serving after the torrent is deleted -
		// so there is nothing to redeem there either.
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
