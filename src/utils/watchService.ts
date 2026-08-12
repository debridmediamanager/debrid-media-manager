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

export type { WatchService };

export type WatchKeys = {
	rdKey?: string | null;
	adKey?: string | null;
	torboxKey?: string | null;
};

export const WATCH_SERVICE_LABEL: Record<WatchService, string> = {
	rd: 'Real-Debrid',
	ad: 'AllDebrid',
	tb: 'TorBox',
	tbw: 'TorBox',
};

/**
 * Which service should serve this stream.
 *
 * Preference order is RD > AD > TB: RD resolves in one server round-trip, AD
 * needs a browser-side magnet upload first, and TB has to add the torrent to
 * the account before it can hand out a link.
 */
export const pickWatchService = (
	result: Pick<SearchResult, 'rdAvailable' | 'adAvailable' | 'tbAvailable'>,
	keys: WatchKeys
): WatchService | null => {
	if (keys.rdKey && result.rdAvailable) return 'rd';
	if (keys.adKey && result.adAvailable) return 'ad';
	if (keys.torboxKey && result.tbAvailable) return 'tb';
	return null;
};

export const watchKeyFor = (service: WatchService, keys: WatchKeys): string | null => {
	if (service === 'rd') return keys.rdKey ?? null;
	if (service === 'ad') return keys.adKey ?? null;
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
	/** AD only: skip cleanup because the magnet is the user's own library entry. */
	adInLibrary?: boolean;
};

/**
 * Opens the chosen player for a torrent.
 *
 * RD and TB resolve entirely inside the API route, so the tab is opened
 * straight at it. AD has to do its magnet prep here first, which means the tab
 * must be opened synchronously on the click and navigated afterwards — opening
 * it after the await is what popup blockers reject.
 */
export const openWatch = async (opts: OpenWatchOptions): Promise<void> => {
	const { service, player, hash, keys, fileName, fileId } = opts;
	const token = watchKeyFor(service, keys);
	if (!token) {
		toast.error(`No ${WATCH_SERVICE_LABEL[service]} key configured.`);
		return;
	}

	if (service !== 'ad') {
		window.open(buildInstantWatchUrl({ service, player, token, hash, fileName, fileId }));
		return;
	}

	const tab = window.open('', '_blank');
	try {
		const link = await resolveAdLink(token, hash, fileName, Boolean(opts.adInLibrary));
		const url = buildLinkWatchUrl({ service, player, token, link });
		if (tab) {
			tab.location.href = url;
		} else {
			window.location.href = url;
		}
	} catch (error: any) {
		tab?.close();
		const message = error instanceof Error ? error.message : String(error);
		toast.error(`AllDebrid watch failed: ${message}`);
	}
};
