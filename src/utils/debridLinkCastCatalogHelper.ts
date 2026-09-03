import {
	isDlFinished,
	listSeedboxTorrents,
	SEEDBOX_PAGE_SIZE,
	type DebridLinkTorrent,
} from '@/services/debridLink';
import { repository as db } from '@/services/repository';
import { resolveDebridLinkTorrentById } from '@/utils/debridLinkCastApiHelpers';

/** How many library entries one Stremio catalog page carries. */
export const PAGE_SIZE = 12;

/**
 * A library entry's id is the Debrid-Link torrent id, and nothing else.
 *
 * Debrid-Link has one row shape and one handle for it: the seedbox torrent id,
 * which `seedbox/list`, `seedbox/activity`, `seedbox/:id/zip` and
 * `seedbox/:ids/remove` all address. There is no Premiumize-style split between
 * transfers, folders and loose files, so - like `dmm-oc:` and unlike
 * `dmm-pm:` - this id carries no kind character.
 */
export const debridLinkMetaId = (torrentId: string) => `dmm-dl:${torrentId}`;

export const parseDebridLinkMetaId = (metaId: string): string | null => {
	const match = /^dmm-dl:(.+)$/.exec(metaId);
	return match ? match[1] : null;
};

const gb = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(2);

async function getProfile(userid: string) {
	try {
		const profile = await db.getDebridLinkCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
		return profile;
	} catch (error) {
		return null;
	}
}

/**
 * One page of the user's Debrid-Link seedbox.
 *
 * Paged through Debrid-Link's own cursor rather than by fetching the whole
 * account and slicing: `listAllSeedboxTorrents` walks every page, and walking a
 * large library on every catalog scroll is the exact request pattern the
 * hour-long `floodDetected` lockout punishes. One request per catalog page,
 * always.
 *
 * The arithmetic is a window inside a Debrid-Link page: Stremio asks in units
 * of 12 and Debrid-Link pages at 100, so the offset picks the Debrid-Link page
 * and the remainder picks the window inside it.
 *
 * Only finished torrents are offered - an unfinished one has no download URLs
 * to hand back, so it would render as an entry that cannot play.
 */
export async function getDebridLinkDMMLibrary(userid: string, page: number) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your Debrid-Link account', status: 401 };
	}

	const offset = Math.max(0, (page - 1) * PAGE_SIZE);
	const dlPage = Math.floor(offset / SEEDBOX_PAGE_SIZE);
	const windowStart = offset % SEEDBOX_PAGE_SIZE;

	const { torrents, pagination } = await listSeedboxTorrents(profile.apiKey, {
		page: dlPage,
		perPage: SEEDBOX_PAGE_SIZE,
	});

	const finished = torrents.filter((torrent: DebridLinkTorrent) => isDlFinished(torrent.status));
	const pageEntries = finished.slice(windowStart, windowStart + PAGE_SIZE);

	return {
		data: {
			metas: pageEntries.map((torrent) => ({
				id: debridLinkMetaId(torrent.id),
				name: torrent.name || torrent.id,
				type: 'other',
			})),
			hasMore:
				windowStart + PAGE_SIZE < finished.length ||
				(typeof pagination?.next === 'number' && pagination.next >= 0),
			cacheMaxAge: 0,
		},
		status: 200,
	};
}

/**
 * The meta for one library entry: its playable files.
 *
 * One request. `seedbox/list?ids=<id>` carries the name, the size and the file
 * list with a live download URL per file - Debrid-Link is the only provider
 * here that needs no second call to turn a library row into a playable listing.
 * It is also the ZIP escape hatch: a torrent with many files lists as a single
 * `isZip: true` entry in the bulk listing and only expands when fetched on its
 * own, which is exactly what this is.
 *
 * The download URLs are deliberately **not** used as the stream url. They are
 * keyless capabilities that keep serving after the torrent is deleted, and a
 * meta can sit in a client's cache indefinitely - so every stream points at
 * `/play/item/<torrentId>` and the URL is resolved there, at play time, and
 * never written into anything a client stores.
 */
export async function getDebridLinkDMMItem(userid: string, torrentId: string) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your Debrid-Link account', status: 401 };
	}

	const metaId = debridLinkMetaId(torrentId);

	let resolved;
	try {
		resolved = await resolveDebridLinkTorrentById(profile.apiKey, torrentId);
	} catch (error) {
		return { error: 'Failed to get item info', status: 500 };
	}

	if (!resolved) {
		return { error: 'No such Debrid-Link torrent', status: 404 };
	}

	const files = resolved.files;
	if (files.length === 0) {
		return { error: 'No video files in this item', status: 404 };
	}

	const videos = files
		.map((file) => ({
			id: `${metaId}:${file.filename}`,
			title: `${file.path} - ${gb(file.size)} GB`,
			streams: [
				{
					url: `${process.env.DMM_ORIGIN}/api/stremio-dl/${userid}/play/item/${encodeURIComponent(
						torrentId
					)}?file=${encodeURIComponent(file.path)}`,
					behaviorHints: { bingeGroup: metaId },
				},
			],
		}))
		.sort((a, b) => a.title.localeCompare(b.title));

	const totalSize = files.reduce((sum, file) => sum + file.size, 0);

	return {
		data: {
			meta: {
				id: metaId,
				type: 'other',
				name: `DMM DL: ${resolved.torrent.name || files[0].filename} - ${gb(totalSize)} GB`,
				videos,
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}
