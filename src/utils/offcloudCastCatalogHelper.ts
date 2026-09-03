import {
	exploreOffcloudCloud,
	extractBtih,
	getOffcloudCacheInfo,
	getOffcloudHistory,
	joinExploreWithCacheInfo,
	type OffcloudHistoryItem,
} from '@/services/offcloud';
import { repository as db } from '@/services/repository';
import { offcloudVideoFiles } from '@/utils/offcloudCastFiles';

export const PAGE_SIZE = 12;

/**
 * A library entry's id is the `requestId`, and nothing else.
 *
 * Offcloud has one row shape and one handle for it: the id `POST /api/cloud`
 * mints, which `cloud/status`, `cloud/explore` and `cloud/remove` all address.
 * There is no Premiumize-style split between transfers, folders and loose
 * files, so - unlike `dmm-pm:` - this id carries no kind character.
 */
export const offcloudMetaId = (requestId: string) => `dmm-oc:${requestId}`;

export const parseOffcloudMetaId = (metaId: string): string | null => {
	const match = /^dmm-oc:(.+)$/.exec(metaId);
	return match ? match[1] : null;
};

const gb = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(2);

async function getProfile(userid: string) {
	try {
		const profile = await db.getOffcloudCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
		return profile;
	} catch (error) {
		return null;
	}
}

/**
 * One page of the user's Offcloud cloud.
 *
 * `cloud/history` is the whole listing endpoint - no paging, no sizes, no file
 * lists - so the page is cut here. Only finished items are offered: an item
 * still in `created` may be a zombie (Offcloud accepts an unusable magnet with
 * a 200 and never finishes or fails it), and `cloud/explore` on an unfinished
 * item has nothing to hand back.
 */
export async function getOffcloudDMMLibrary(userid: string, page: number) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your Offcloud account', status: 401 };
	}

	const history = await getOffcloudHistory(profile.apiKey);
	const entries = history.filter(
		(entry) => entry.status === 'downloaded' && typeof entry.requestId === 'string'
	);

	const skip = (page - 1) * PAGE_SIZE;
	const pageEntries = entries.slice(skip, skip + PAGE_SIZE);

	return {
		data: {
			metas: pageEntries.map((entry) => ({
				id: offcloudMetaId(entry.requestId),
				name: entry.fileName || entry.requestId,
				type: 'other',
			})),
			hasMore: skip + PAGE_SIZE < entries.length,
			cacheMaxAge: 0,
		},
		status: 200,
	};
}

/**
 * The meta for one library entry: its playable files.
 *
 * Three calls at most, and each one earns its place. `cloud/explore` is the
 * only source of links; `cloud/history` is the only place the release name and
 * the original magnet live; `cache/info` is the only source of names and byte
 * sizes, and it needs the magnet form - a bare hash there silently reports
 * cached content as uncached. The last two are best effort: without them the
 * listing still renders, off the decoded basenames in the CDN paths.
 *
 * The explore URLs are deliberately **not** used as the stream url. They are
 * signed with a mint timestamp and carry the account's own token, while a meta
 * can sit in a client's cache long after it was built - so every stream points
 * at `/play/item/<requestId>` and the link is minted there, at play time, and
 * never written into anything a client stores.
 */
export async function getOffcloudDMMItem(userid: string, requestId: string) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your Offcloud account', status: 401 };
	}

	const metaId = offcloudMetaId(requestId);

	let links: string[];
	try {
		links = await exploreOffcloudCloud(profile.apiKey, requestId);
	} catch (error) {
		return { error: 'Failed to get item info', status: 500 };
	}

	let entry: OffcloudHistoryItem | undefined;
	try {
		entry = (await getOffcloudHistory(profile.apiKey)).find(
			(item) => item.requestId === requestId
		);
	} catch (error) {
		// The name and the hash are decoration here; the links are the meta.
	}

	const hash = entry?.originalLink ? extractBtih(entry.originalLink) : null;
	let cacheFiles: { folder: string; filename: string; size: number }[] = [];
	if (hash) {
		try {
			const [info] = await getOffcloudCacheInfo(profile.apiKey, [hash]);
			cacheFiles = info?.files ?? [];
		} catch (error) {
			// Sizes are decoration too.
		}
	}

	const files = offcloudVideoFiles(joinExploreWithCacheInfo(links, cacheFiles));
	if (files.length === 0) {
		return { error: 'No video files in this item', status: 404 };
	}

	const videos = files
		.map((file) => ({
			id: `${metaId}:${file.filename}`,
			title: `${file.path} - ${gb(file.size)} GB`,
			streams: [
				{
					url: `${process.env.DMM_ORIGIN}/api/stremio-oc/${userid}/play/item/${encodeURIComponent(
						requestId
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
				name: `DMM OC: ${entry?.fileName ?? files[0].filename} - ${gb(totalSize)} GB`,
				videos,
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}
