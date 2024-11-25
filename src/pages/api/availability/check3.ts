import { PlanetScaleCache } from '@/services/planetscale';
import { addHashAsMagnet, deleteTorrent, getTorrentInfo, selectFiles } from '@/services/realDebrid';
import { TorrentInfoResponse } from '@/services/types';
import { isVideo } from '@/utils/selectable';
import { NextApiHandler } from 'next';

const db = new PlanetScaleCache();

interface SearchResult {
	title: string;
	fileSize: number;
	hash: string;
}

interface DbResult {
	key: string;
	value: SearchResult;
}

const TERMINAL_STATUS = ['magnet_error', 'error', 'virus', 'dead'];

const handler: NextApiHandler = async (req, res) => {
	const rdKey = process.env.REALDEBRID_KEY;
	if (!rdKey) {
		return res.status(500).json({ error: 'RealDebrid key not configured' });
	}

	const { imdbId } = req.query;
	let imdbIds: string[] = [];
	if (!!imdbId) {
		imdbIds = [imdbId as string];
	} else {
		const movieImdbIds = (await db.getAllImdbIds('movie')) || [];
		const tvImdbIds = (await db.getAllImdbIds('tv')) || [];
		imdbIds = [...movieImdbIds, ...tvImdbIds];
		// make sure to remove duplicates
		imdbIds = [...new Set(imdbIds)];
	}

	console.log(`Checking availability for ${imdbIds.length} imdbIds`);

	for (const imdbId of imdbIds) {
		try {
			const searchResults = await getSearchResults(imdbId);
			if (!searchResults.length) {
				console.log(`No search results for ${imdbId}`);
				continue;
			}
			console.log(`Found ${searchResults.length} search results for ${imdbId}`);

			const availableHashes = await getAvailableHashes(imdbId, searchResults);
			let newResults = searchResults.filter((result) => !availableHashes.has(result.hash));
			console.log(`Found ${newResults.length} new results for ${imdbId}`);
			// newResults.sort((a, b) => a.fileSize - b.fileSize);
			// shuffle results
			newResults.sort(() => Math.random() - 0.5);

			const resultsToProcess = !!imdbId ? newResults : newResults.splice(0, 50);
			for (const result of resultsToProcess) {
				console.log(`Processing hash ${result.hash}`);
				await processTorrent(result.hash, imdbId, rdKey);
			}

			res.status(200).json({ results: 'done' });
		} catch (error) {
			console.error(`Error processing ${imdbId}: ${error}`);
			res.status(500).json({ error: 'Internal server error' });
		}
	}
};

async function processTorrent(hash: string, imdbId: string, rdKey: string): Promise<void> {
	let id = '';
	try {
		id = await addHashAsMagnet(rdKey, hash, true);
		// console.log(`Added torrent ${id}`);

		let torrentInfo = await getTorrentInfo(rdKey, id, true);
		while (torrentInfo.status === 'queued') {
			console.log(`Torrent ${id} is queued`);
			await new Promise((resolve) => setTimeout(resolve, 5000));
			torrentInfo = await getTorrentInfo(rdKey, id, true);
		}

		if (torrentInfo.status === 'waiting_files_selection') {
			const fileIDs = await getFileIDsToSelect(torrentInfo);
			if (fileIDs.length === 0) {
				throw new Error(`No files to select for torrent ${id}`);
			}

			await selectFiles(rdKey, id, fileIDs, true);
			// console.log(`Selected files for torrent ${id}`);

			const updatedInfo = await getTorrentInfo(rdKey, id, true);
			// console.log(`Status of torrent ${id}: ${updatedInfo.status}`);

			if (updatedInfo.status !== 'downloaded') {
				throw new Error(`Torrent ${id} is not cached, status: ${updatedInfo.status}`);
			}

			await handleDownloadedTorrent(updatedInfo, hash, imdbId);
			console.log(`**Successfully** processed hash >>> ${hash}`);
		} else if (TERMINAL_STATUS.includes(torrentInfo.status)) {
			await handleDownloadedTorrent(torrentInfo, hash, imdbId);
			console.log(`!!Terminal status!! processed hash >>> ${hash} = ${torrentInfo.status}`);
		} else {
			console.log(`Torrent ${id} is not ready yet, status: ${torrentInfo.status}`);
		}

		await deleteTorrent(rdKey, id, true);
	} catch (error) {
		if (id) await deleteTorrent(rdKey, id, true);
		console.error(`Error processing hash ${hash}: ${error}`);
	}
}

async function getFileIDsToSelect(torrentInfo: TorrentInfoResponse): Promise<string[]> {
	let selectedFiles = torrentInfo.files.filter(isVideo).map((file) => `${file.id}`);
	if (selectedFiles.length === 0) {
		// select all files if no videos
		selectedFiles = torrentInfo.files.map((file) => `${file.id}`);
	}
	return selectedFiles;
}

async function handleDownloadedTorrent(
	torrentInfo: TorrentInfoResponse,
	hash: string,
	imdbId: string
): Promise<void> {
	const selectedFiles = torrentInfo.files?.filter((file) => file.selected === 1) || [];

	if (selectedFiles.length === 0 || selectedFiles.length !== (torrentInfo.links?.length || 0)) {
		if (torrentInfo.status === 'downloaded') {
			torrentInfo.status = 'partially_downloaded';
		}
	}

	if (!torrentInfo.ended) {
		torrentInfo.ended = '0';
	}

	const baseData = {
		hash,
		imdbId,
		filename: torrentInfo.filename,
		originalFilename: torrentInfo.original_filename,
		bytes: BigInt(torrentInfo.bytes || 0),
		originalBytes: BigInt(torrentInfo.original_bytes || 0),
		host: 'real-debrid.com',
		progress: torrentInfo.progress,
		status: torrentInfo.status,
		ended: new Date(torrentInfo.ended),
	};

	await db.prisma.available.upsert({
		where: { hash },
		update: {
			...baseData,
			files:
				selectedFiles.length > 0
					? {
							deleteMany: {},
							create: selectedFiles.map((file, index) => ({
								link: torrentInfo.links?.[index] || '',
								file_id: file.id,
								path: file.path,
								bytes: BigInt(file.bytes || 0),
							})),
						}
					: undefined,
		},
		create: {
			...baseData,
			files:
				selectedFiles.length > 0
					? {
							create: selectedFiles.map((file, index) => ({
								link: torrentInfo.links?.[index] || '',
								file_id: file.id,
								path: file.path,
								bytes: BigInt(file.bytes || 0),
							})),
						}
					: undefined,
		},
	});
}

async function getSearchResults(imdbId: string): Promise<SearchResult[]> {
	const results = await Promise.all([
		db.prisma.scraped.findMany({
			where: {
				OR: [{ key: `movie:${imdbId}` }, { key: { startsWith: `tv:${imdbId}:` } }],
			},
		}),
		db.prisma.scrapedTrue.findMany({
			where: {
				OR: [{ key: `movie:${imdbId}` }, { key: { startsWith: `tv:${imdbId}:` } }],
			},
		}),
	]);

	return results
		.flat()
		.map((result) => (result as unknown as DbResult).value)
		.flat()
		.filter(Boolean);
}

async function getAvailableHashes(
	imdbId: string,
	searchResults: SearchResult[]
): Promise<Set<string>> {
	const hashes = searchResults.map((result) => result.hash);
	const availableHashes = await db.prisma.available.findMany({
		where: {
			imdbId,
			hash: { in: hashes },
		},
		select: {
			hash: true,
		},
	});

	return new Set(availableHashes.map((ah) => ah.hash));
}

export default handler;
