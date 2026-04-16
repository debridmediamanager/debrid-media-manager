import {
	getMagnetFiles,
	getMagnetStatus,
	getMagnetStatusAd,
	MagnetFile,
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

export async function getAllDebridDMMLibrary(apiKey: string, page: number) {
	try {
		// Get all magnets (don't use status=active filter - it means "downloading", not "ready")
		console.log('[AD Library] Fetching magnets, page:', page);
		const result = await getMagnetStatus(apiKey);

		if (!result.data?.magnets) {
			console.log('[AD Library] No magnets data in response');
			return [];
		}

		console.log('[AD Library] Total magnets:', result.data.magnets.length);

		// Filter for ready magnets (statusCode 4 = Ready)
		const readyMagnets = result.data.magnets.filter((m) => m.statusCode === 4);
		console.log('[AD Library] Ready magnets:', readyMagnets.length);

		// Paginate
		const offset = page * PAGE_SIZE;
		const paginatedMagnets = readyMagnets.slice(offset, offset + PAGE_SIZE);

		return paginatedMagnets.map((magnet) => ({
			id: `dmm-ad:${magnet.id}`,
			name: magnet.filename,
			type: 'other',
		}));
	} catch (error) {
		console.error('[AD Library] Error getting AllDebrid library:', error);
		return [];
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
