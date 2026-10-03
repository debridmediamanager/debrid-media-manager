import {
	PremiumizeFolderEntry,
	getPremiumizeItemDetails,
	listPremiumizeFolder,
} from '@/services/premiumize';
import { repository as db } from '@/services/repository';
import { isVideo } from '@/utils/selectable';

export const PAGE_SIZE = 12;

/** How many `folder/list` calls one meta may spend walking a release. */
const MAX_FOLDER_CALLS = 20;
/** How deep inside a release to look for video files. */
const MAX_FOLDER_DEPTH = 3;

/**
 * A library entry's id carries what it is, not just which it is.
 *
 * Premiumize's cloud root mixes folders (a release) and loose files (a single
 * upload), and the two resolve through different endpoints - `folder/list` and
 * `item/details`. Encoding the kind in the meta id means the meta handler picks
 * the right one instead of calling one and guessing from the failure.
 */
export type PremiumizeEntryKind = 'folder' | 'file';

export const premiumizeMetaId = (kind: PremiumizeEntryKind, id: string) => `dmm-pm:${kind}:${id}`;

export const parsePremiumizeMetaId = (
	metaId: string
): { kind: PremiumizeEntryKind; id: string } | null => {
	const match = /^dmm-pm:(folder|file):(.+)$/.exec(metaId);
	return match ? { kind: match[1] as PremiumizeEntryKind, id: match[2] } : null;
};

const gb = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(2);

/**
 * The cast profile, or null when there is none. A database error propagates:
 * read as "no profile", it would tell the member to set up an addon that is
 * fine, over an outage that is ours.
 */
async function getProfile(userid: string) {
	return db.getPremiumizeCastProfile(userid);
}

/**
 * One page of the user's Premiumize cloud.
 *
 * `folder/list` has no server-side paging - it answers the whole root in one
 * call - so the page is cut here. Loose root files are filtered to videos: a
 * stray `.nzb` or `.txt` sitting in the root renders as a library entry that
 * plays nothing. Folders are always kept; what is inside them is only known
 * once the meta is opened.
 *
 * Unlike the other library catalogs these entries get no cover art: neither
 * `folder/list` nor `transfer/list` reports an info hash, and `job/src` would
 * cost one request per entry to find one.
 */
export async function getPremiumizeDMMLibrary(userid: string, page: number) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your Premiumize account', status: 401 };
	}

	const root = await listPremiumizeFolder(profile.apiKey);
	const entries = (root.content ?? [])
		.filter((entry) => entry.type === 'folder' || isVideo({ path: entry.name }))
		.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

	const skip = (page - 1) * PAGE_SIZE;
	const pageEntries = entries.slice(skip, skip + PAGE_SIZE);

	return {
		data: {
			metas: pageEntries.map((entry) => ({
				id: premiumizeMetaId(entry.type === 'folder' ? 'folder' : 'file', entry.id),
				name: entry.name,
				type: 'other',
			})),
			hasMore: skip + PAGE_SIZE < entries.length,
			cacheMaxAge: 0,
		},
		status: 200,
	};
}

/**
 * Every video inside a release, flattened.
 *
 * A release folder can nest - `Screens/`, `Subs/`, a season's episode folders -
 * so this walks down, bounded on both calls and depth so one oversized folder
 * cannot turn a meta request into a hundred round trips.
 */
async function collectVideoFiles(
	apiKey: string,
	folderId: string
): Promise<{ name: string; files: Array<PremiumizeFolderEntry & { path: string }> }> {
	const files: Array<PremiumizeFolderEntry & { path: string }> = [];
	const queue: Array<{ id: string; path: string; depth: number }> = [
		{ id: folderId, path: '', depth: 0 },
	];
	let name = '';
	let calls = 0;

	while (queue.length > 0 && calls < MAX_FOLDER_CALLS) {
		const current = queue.shift()!;
		calls++;

		let listing;
		try {
			listing = await listPremiumizeFolder(apiKey, current.id);
		} catch (error) {
			// The release itself not listing is the answer - a refused key, a
			// folder that is gone - and the route has to see it. A subfolder
			// that will not list is not a reason to lose the ones that did.
			if (current.depth === 0) throw error;
			continue;
		}

		if (current.depth === 0) {
			name = listing.name ?? '';
		}

		for (const entry of listing.content ?? []) {
			const path = current.path ? `${current.path}/${entry.name}` : entry.name;
			if (entry.type === 'folder') {
				if (current.depth + 1 <= MAX_FOLDER_DEPTH) {
					queue.push({ id: entry.id, path, depth: current.depth + 1 });
				}
				continue;
			}
			if (isVideo({ path: entry.name })) {
				files.push({ ...entry, path });
			}
		}
	}

	return { name, files };
}

const buildVideo = (
	userid: string,
	metaId: string,
	fileId: string,
	title: string,
	size: number
) => ({
	id: `${metaId}:${fileId}`,
	title: `${title} - ${gb(size)} GB`,
	streams: [
		{
			url: `${process.env.DMM_ORIGIN}/api/stremio-pm/${userid}/play/item/${fileId}`,
			behaviorHints: {
				bingeGroup: metaId,
			},
		},
	],
});

/**
 * The meta for one library entry: its playable files.
 *
 * The links `folder/list` already hands back are deliberately not used as the
 * stream url. Premiumize's CDN links expire on an undocumented schedule, and a
 * meta can sit in a client's cache long after it was built, so every stream
 * points at `/play/item/<id>` and the link is minted there, at play time.
 */
export async function getPremiumizeDMMItem(
	userid: string,
	kind: PremiumizeEntryKind,
	entryId: string
) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your Premiumize account', status: 401 };
	}

	const metaId = premiumizeMetaId(kind, entryId);

	if (kind === 'file') {
		// Errors propagate: the route tells a refused key from a missing file.
		const details = await getPremiumizeItemDetails(profile.apiKey, entryId);
		const size = details.size ?? 0;
		return {
			data: {
				meta: {
					id: metaId,
					type: 'other',
					name: `DMM PM: ${details.name} - ${gb(size)} GB`,
					videos: [buildVideo(userid, metaId, entryId, details.name, size)],
				},
				cacheMaxAge: 0,
			},
			status: 200,
		};
	}

	const folder = await collectVideoFiles(profile.apiKey, entryId);

	if (folder.files.length === 0) {
		return { error: 'No video files in this folder', status: 404 };
	}

	const videos = folder.files
		.map((file) => buildVideo(userid, metaId, file.id, file.path, file.size ?? 0))
		.sort((a, b) => a.title.localeCompare(b.title));

	const totalSize = folder.files.reduce((sum, file) => sum + (file.size ?? 0), 0);

	return {
		data: {
			meta: {
				id: metaId,
				type: 'other',
				name: `DMM PM: ${folder.name} - ${gb(totalSize)} GB`,
				videos,
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}
