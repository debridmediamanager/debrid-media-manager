import { deleteMagnetAd } from '@/services/allDebrid';
import { FileData, SearchResult } from '@/services/mediasearch';
import type { WatchService } from '@/utils/intent';
import { isVideo } from '@/utils/selectable';
import toast from 'react-hot-toast';
import {
	findVideoByName,
	pickBiggestVideo,
	prepareMagnetForCast,
} from './allDebridCastClientPipeline';
import { renderWatchTab } from './watchTab';

export type { WatchService };

export type WatchKeys = {
	rdKey?: string | null;
	adKey?: string | null;
	torboxKey?: string | null;
	premiumizeKey?: string | null;
	offcloudKey?: string | null;
	debridLinkKey?: string | null;
};

export const WATCH_SERVICE_LABEL: Record<WatchService, string> = {
	rd: 'Real-Debrid',
	ad: 'AllDebrid',
	tb: 'TorBox',
	tbw: 'TorBox',
	pm: 'Premiumize',
	oc: 'Offcloud',
	dl: 'Debrid-Link',
};

/**
 * Which service should serve this stream.
 *
 * Preference order is RD > AD > TB > PM > OC. RD resolves in one server
 * round-trip, AD needs a browser-side magnet upload first, and TB has to add the
 * torrent to the account before it can hand out a link. Premiumize is the
 * cheapest of them all in isolation - one stateless call, nothing written to the
 * account - but it sits behind the three so that adding a Premiumize key never
 * silently takes playback away from the service a user already had.
 *
 * Offcloud goes last of all, and behind Premiumize specifically. The two serve
 * the same objects off the same CDN, so the stream is identical either way - but
 * Premiumize's `directdl` resolves it without touching the account, while
 * Offcloud has to add the item and leaves a cloud entry behind. Given a free
 * choice between two paths to the same bytes, take the one that mutates nothing.
 *
 * **Debrid-Link is not in this order at all, and cannot be.** It has no cache
 * probe - `/seedbox/cached` is disabled and nothing replaced it - so no
 * `dlAvailable` flag exists to test, and inventing one would mean answering
 * "false" for every row whether or not Debrid-Link holds it. `'dl'` is still a
 * `WatchService`, reached from a library row or from a search row the user has
 * already added, where the answer is known rather than guessed.
 */
export const pickWatchService = (
	result: Pick<
		SearchResult,
		'rdAvailable' | 'adAvailable' | 'tbAvailable' | 'pmAvailable' | 'ocAvailable'
	>,
	keys: WatchKeys
): WatchService | null => {
	if (keys.rdKey && result.rdAvailable) return 'rd';
	if (keys.adKey && result.adAvailable) return 'ad';
	if (keys.torboxKey && result.tbAvailable) return 'tb';
	if (keys.premiumizeKey && result.pmAvailable) return 'pm';
	if (keys.offcloudKey && result.ocAvailable) return 'oc';
	return null;
};

/**
 * Which service's info modal a search result should open.
 *
 * The modal's Watch rows inherit the service the modal was opened for, so this
 * has to agree with `pickWatchService` or those rows target a service that does
 * not hold the torrent. When nothing is cached anywhere there is no watchable
 * service to agree with, and the modal is still the file list and the
 * add-to-library surface, so it falls back to whichever key exists.
 */
export const pickInfoService = (
	result: Pick<
		SearchResult,
		'rdAvailable' | 'adAvailable' | 'tbAvailable' | 'pmAvailable' | 'ocAvailable'
	>,
	keys: WatchKeys
): WatchService | null => {
	const watchable = pickWatchService(result, keys);
	if (watchable) return watchable;
	if (keys.rdKey) return 'rd';
	if (keys.adKey) return 'ad';
	if (keys.torboxKey) return 'tb';
	if (keys.premiumizeKey) return 'pm';
	if (keys.offcloudKey) return 'oc';
	return null;
};

export const watchKeyFor = (service: WatchService, keys: WatchKeys): string | null => {
	if (service === 'rd') return keys.rdKey ?? null;
	if (service === 'ad') return keys.adKey ?? null;
	if (service === 'pm') return keys.premiumizeKey ?? null;
	if (service === 'oc') return keys.offcloudKey ?? null;
	if (service === 'dl') return keys.debridLinkKey ?? null;
	// 'tb' and 'tbw' are both TorBox, differing only in which namespace the
	// server resolves the hash against.
	return keys.torboxKey ?? null;
};

export const getBiggestVideoFile = (result: Pick<SearchResult, 'files'>): FileData | undefined => {
	if (!result.files || !result.files.length) return undefined;
	return result.files
		.filter((f) => isVideo({ path: f.filename }))
		.sort((a, b) => b.filesize - a.filesize)[0];
};

const withQuery = (path: string, params: Record<string, string | undefined>) => {
	const search = new URLSearchParams();
	for (const [name, value] of Object.entries(params)) {
		if (value !== undefined && value !== '') search.set(name, value);
	}
	return `${path}?${search.toString()}`;
};

// `player` is a two-segment path ("android/com.brouken.player"), so it is
// interpolated into the path and must not be query-encoded.
export const buildInstantWatchUrl = (params: {
	service: WatchService;
	player: string;
	token: string;
	hash: string;
	fileName?: string;
	fileId?: number | string;
}) =>
	withQuery(`/api/watch/instant/${params.player}`, {
		service: params.service,
		token: params.token,
		hash: params.hash,
		fileName: params.fileName,
		fileId: params.fileId === undefined ? undefined : String(params.fileId),
	});

export const buildLinkWatchUrl = (params: {
	service: WatchService;
	player: string;
	token: string;
	link: string;
}) =>
	withQuery(`/api/watch/${params.player}`, {
		service: params.service,
		token: params.token,
		link: params.link,
	});

/**
 * Asks the server for the player intent.
 *
 * The two GET routes take the debrid key in the query string, which puts it in
 * the address bar of the tab that opens and in every access log on the way. This
 * posts it in a body instead and navigates to the intent the server hands back.
 */
export const resolveWatchIntent = async (params: {
	service: WatchService;
	player: string;
	token: string;
	hash?: string;
	fileName?: string;
	fileId?: number | string;
	link?: string;
}): Promise<string> => {
	const response = await fetch(`/api/watch/resolve/${params.player}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			service: params.service,
			token: params.token,
			hash: params.hash,
			fileName: params.fileName,
			fileId: params.fileId === undefined ? undefined : String(params.fileId),
			link: params.link,
		}),
	});
	const data = await response.json().catch(() => ({}) as { intent?: string; error?: string });
	if (!response.ok || !data.intent) {
		throw new Error(data.error || `Watch request failed (${response.status})`);
	}
	return data.intent;
};

/**
 * Resolves an AllDebrid magnet in the browser and returns the file link.
 *
 * AllDebrid refuses `magnet/upload` from datacenter IPs (NO_SERVER), so this
 * cannot move to the API route — see allDebridCastClientPipeline. The magnet is
 * removed again unless the caller says it was already in the user's library;
 * the unlocked link keeps working afterwards.
 */
const resolveAdLink = async (
	adKey: string,
	hash: string,
	fileName: string | undefined,
	alreadyInLibrary: boolean
): Promise<string> => {
	const { magnetId, videoFiles } = await prepareMagnetForCast(adKey, hash);
	const picked =
		(fileName ? findVideoByName(videoFiles, fileName) : null) ?? pickBiggestVideo(videoFiles);

	if (!alreadyInLibrary) {
		await deleteMagnetAd(adKey, magnetId).catch(() => {});
	}
	return picked.link;
};

export type OpenWatchOptions = {
	service: WatchService;
	player: string;
	hash: string;
	keys: WatchKeys;
	fileName?: string;
	fileId?: number | string;
	/**
	 * An already-resolved service link for this file, which a library torrent's
	 * row has and a search result does not. With it, RD unrestricts the link it
	 * was given; without it, RD re-adds the hash as a magnet — and RD stalls on
	 * content the account already holds, so the link is what keeps watching a
	 * library torrent working.
	 */
	link?: string;
	/** AD only: skip cleanup because the magnet is the user's own library entry. */
	adInLibrary?: boolean;
};

// `player` is "<os>/<package>", and the os half decides whether the intent can
// be navigated to by script at all.
const osOf = (player: string) => player.split('/')[0];

/**
 * Opens the chosen player for a torrent.
 *
 * The tab is opened synchronously on the click and filled in once the server
 * answers — opening it after the await is what popup blockers reject. It is
 * handed a Play link rather than navigated straight at the player: Android
 * Chrome blocks a scripted jump to `intent://`, which left the tab sitting on
 * about:blank forever. See `watchTab` for the whole rule. AllDebrid needs its
 * magnet prepared here first, in the browser, because AllDebrid refuses
 * `magnet/upload` from a datacenter IP.
 */
export const openWatch = async (opts: OpenWatchOptions): Promise<void> => {
	const { service, player, hash, keys, fileName, fileId } = opts;
	const label = WATCH_SERVICE_LABEL[service];
	const token = watchKeyFor(service, keys);
	if (!token) {
		toast.error(`No ${label} key configured.`);
		return;
	}

	const tab = window.open('', '_blank');
	renderWatchTab(tab, { status: 'resolving', label });
	try {
		const link =
			opts.link ||
			(service === 'ad'
				? await resolveAdLink(token, hash, fileName, Boolean(opts.adInLibrary))
				: undefined);
		const intent = await resolveWatchIntent({
			service,
			player,
			token,
			hash,
			fileName,
			fileId,
			link,
		});
		if (!tab) {
			window.location.href = intent;
			return;
		}
		renderWatchTab(tab, { status: 'ready', label, intent });
		// Elsewhere a scripted navigation still launches the player, so keep the
		// press-nothing path those users have always had. On Android it is worse
		// than useless: Chrome refuses the launch and spends the intent's
		// fallback URL doing it, dropping the user on a raw stream in the browser
		// instead of the player they chose. There, the tap is the only attempt.
		if (osOf(player) !== 'android') {
			tab.location.href = intent;
		}
	} catch (error: any) {
		const message = error instanceof Error ? error.message : String(error);
		// Once the watch tab has focus the opener is a background tab, so a toast
		// there is invisible on a phone or a TV box — the tab has to say it too.
		renderWatchTab(tab, { status: 'error', label, message });
		toast.error(`${label} watch failed: ${message}`);
	}
};
