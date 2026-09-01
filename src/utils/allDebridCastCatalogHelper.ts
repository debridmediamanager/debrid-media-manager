import {
	AllDebridSavedLink,
	getMagnetFiles,
	getMagnetStatus,
	getMagnetStatusAd,
	getSavedLinks,
	MagnetFile,
	unlockLink,
} from '@/services/allDebrid';

export const PAGE_SIZE = 12;

interface FlatFile {
	path: string;
	size: number;
	link: string;
}

function flattenFiles(files: MagnetFile[], parentPath: string = ''): FlatFile[] {
	const result: FlatFile[] = [];

	for (const file of files) {
		const fullPath = parentPath ? `${parentPath}/${file.n}` : file.n;

		if (file.l) {
			result.push({
				path: fullPath,
				size: file.s || 0,
				link: file.l,
			});
		} else if (file.e) {
			result.push(...flattenFiles(file.e, fullPath));
		}
	}

	return result;
}

/**
 * One page of the user's AllDebrid library. `page` is 1-based, as it is for the
 * Real-Debrid, TorBox and Premiumize catalogs.
 *
 * `hasMore` is part of the answer, not decoration: without it a client has no
 * reason to ask for a second page, so the library reads as 12 items long.
 */
/**
 * A saved link has no id of its own - AllDebrid keys it by the URL - so the
 * library meta id carries the URL itself, base64url encoded so it survives a
 * path segment intact.
 */
export const savedLinkMetaId = (link: string) =>
	`l${Buffer.from(link, 'utf8').toString('base64url')}`;

export const parseSavedLinkMetaId = (idPart: string): string | null => {
	if (!idPart.startsWith('l')) return null;
	try {
		const link = Buffer.from(idPart.slice(1), 'base64url').toString('utf8');
		return link.startsWith('http') ? link : null;
	} catch {
		return null;
	}
};

/**
 * The user's saved hoster links, as library metas.
 *
 * Read whole - the list is small and unpaged at the vendor - and degraded to
 * empty on failure, because losing it must not cost the user their magnets.
 */
async function fetchSavedLinkMetas(apiKey: string) {
	let links: AllDebridSavedLink[] = [];
	try {
		links = await getSavedLinks(apiKey);
	} catch (error) {
		console.error(
			'[AD Library] saved links unavailable:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return [];
	}
	return links.map((saved) => ({
		id: `dmm-ad:${savedLinkMetaId(saved.link)}`,
		name: saved.filename,
		type: 'other',
	}));
}

/**
 * The meta for one saved link: a single file, resolved fresh.
 *
 * `link/unlock` is what turns a saved hoster link into a playable URL, and it
 * works from a datacenter IP - measured 2026-09-01 from dmm-01 as well as a
 * residential line, unlike AllDebrid's magnet upload path.
 */
export async function getAllDebridSavedLink(apiKey: string, idPart: string, userid: string) {
	const link = parseSavedLinkMetaId(idPart);
	if (!link) {
		return { error: 'Invalid saved link id', status: 400 };
	}

	let unlocked;
	try {
		unlocked = await unlockLink(apiKey, link);
	} catch (error) {
		return { error: 'Failed to unlock saved link', status: 500 };
	}

	const metaId = `dmm-ad:${idPart}`;
	const size = unlocked.filesize ?? 0;
	return {
		data: {
			meta: {
				id: metaId,
				type: 'other',
				name: `DMM AD: ${unlocked.filename} - ${(size / 1024 / 1024 / 1024).toFixed(2)} GB`,
				videos: [
					{
						id: `${metaId}:0`,
						title: `${unlocked.filename} - ${(size / 1024 / 1024 / 1024).toFixed(2)} GB`,
						streams: [
							{
								url: `${process.env.DMM_ORIGIN}/api/stremio-ad/${userid}/play/${idPart}:0`,
								behaviorHints: { bingeGroup: metaId },
							},
						],
					},
				],
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}

export async function getAllDebridDMMLibrary(apiKey: string, page: number) {
	try {
		// Get all magnets (don't use status=active filter - it means "downloading", not "ready")
		console.log('[AD Library] Fetching magnets, page:', page);
		const result = await getMagnetStatus(apiKey);

		if (!result.data?.magnets) {
			console.log('[AD Library] No magnets data in response');
			return { metas: [], hasMore: false };
		}

		console.log('[AD Library] Total magnets:', result.data.magnets.length);

		// Filter for ready magnets (statusCode 4 = Ready)
		const readyMagnets = result.data.magnets.filter((m) => m.statusCode === 4);
		console.log('[AD Library] Ready magnets:', readyMagnets.length);

		// Saved hoster links are a second library AllDebrid keeps apart from
		// magnets. They come first: the list is short and the whole of it is
		// known, so paging stays a slice over one concatenated array.
		const entries = [
			...(await fetchSavedLinkMetas(apiKey)),
			...readyMagnets.map((magnet) => ({
				id: `dmm-ad:${magnet.id}`,
				name: magnet.filename,
				type: 'other',
			})),
		];

		// Paginate
		const offset = (page - 1) * PAGE_SIZE;

		return {
			metas: entries.slice(offset, offset + PAGE_SIZE),
			hasMore: offset + PAGE_SIZE < entries.length,
		};
	} catch (error) {
		console.error('[AD Library] Error getting AllDebrid library:', error);
		return { metas: [], hasMore: false };
	}
}

export async function getAllDebridDMMTorrent(apiKey: string, magnetID: string, userid: string) {
	const magnetIdNum = parseInt(magnetID, 10);
	if (isNaN(magnetIdNum)) {
		return { error: 'Invalid magnet ID', status: 400 };
	}

	try {
		// Get magnet files with download links
		const filesResult = await getMagnetFiles(apiKey, [magnetIdNum]);
		const magnetFiles = filesResult.magnets?.[0];

		if (!magnetFiles) {
			return { error: 'Magnet files not found', status: 404 };
		}

		if (magnetFiles.error) {
			return { error: magnetFiles.error.message, status: 500 };
		}

		// Also get magnet info for the name (use getMagnetStatusAd for single ID - returns object not array)
		const magnet = await getMagnetStatusAd(apiKey, magnetIdNum);

		if (!magnet) {
			return { error: 'Magnet not found', status: 404 };
		}

		// Flatten files
		const flatFiles = flattenFiles(magnetFiles.files || []);

		// Filter for video files, then sort by filename so the index assigned here
		// matches the index that /play/[hash].ts resolves (it sorts by filename too).
		const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
		const videoFiles = flatFiles
			.filter((f) => {
				const filename = f.path.split('/').pop()?.toLowerCase() || '';
				return videoExtensions.some((ext) => filename.endsWith(ext));
			})
			.sort((a, b) => {
				const aName = a.path.split('/').pop() || '';
				const bName = b.path.split('/').pop() || '';
				return aName.localeCompare(bName);
			});

		const videos = videoFiles.map((file, index) => ({
			id: `dmm-ad:${magnetID}:${index}`,
			title: `${file.path.split('/').pop()} - ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
			streams: [
				{
					url: `${process.env.DMM_ORIGIN}/api/stremio-ad/${userid}/play/${magnetID}:${index}`,
					behaviorHints: {
						bingeGroup: `dmm-ad:${magnetID}`,
					},
				},
			],
		}));

		const totalSize = flatFiles.reduce((sum, f) => sum + f.size, 0);

		return {
			data: {
				meta: {
					id: `dmm-ad:${magnetID}`,
					type: 'other',
					name: `DMM AD: ${magnet.filename} - ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`,
					videos,
				},
				cacheMaxAge: 0,
			},
			status: 200,
		};
	} catch (error) {
		console.error('Error getting AllDebrid torrent:', error);
		return { error: 'Failed to get torrent info', status: 500 };
	}
}
