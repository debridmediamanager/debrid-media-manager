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

const handler: NextApiHandler = async (req, res) => {
	const { imdbId } = req.query;

	let imdbIds = !!imdbId ? [imdbId as string] : await db.getAllImdbIds('movie');
	const rdKey = process.env.REALDEBRID_KEY;
	if (!rdKey) {
		return res.status(500).json({ error: 'RealDebrid key not configured' });
	}

	for (let imdbId in imdbIds) {
		try {
			const searchResults = await getSearchResults(imdbId);
			if (!searchResults.length) {
				return res.status(404).json({ error: 'No results found' });
			}

			const availableHashes = await getAvailableHashes(imdbId, searchResults);
			const newResults = searchResults.filter((result) => !availableHashes.has(result.hash));

			for (const result of newResults) {
				console.log(`Processing hash ${result.hash}`);
				await processTorrent(result.hash, imdbId, rdKey);
			}

			res.status(200).json({ results: 'done' });
		} catch (error) {
			console.error('Error in availability check:', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	}
};

async function processTorrent(hash: string, imdbId: string, rdKey: string): Promise<void> {
	let id = '';
	try {
		id = await addHashAsMagnet(rdKey, hash, true);
		console.log(`Added torrent ${id}`);

		const torrentInfo = await getTorrentInfo(rdKey, id, true);
		if (torrentInfo.status !== 'waiting_files_selection') {
			throw new Error(`Torrent ${id} status: ${torrentInfo.status}`);
		}

		const fileIDs = await getFileIDsToSelect(torrentInfo);
		if (fileIDs.length === 0) {
			throw new Error(`No files to select for torrent ${id}`);
		}

		await selectFiles(rdKey, id, fileIDs, true);
		console.log(`Selected files for torrent ${id}`);

		const updatedInfo = await getTorrentInfo(rdKey, id, true);
		console.log(`Status of torrent ${id}: ${updatedInfo.status}`);

		if (updatedInfo.status !== 'downloaded') {
			throw new Error(`Torrent ${id} is not cached`);
		}

		await handleDownloadedTorrent(updatedInfo, hash, imdbId);
		await deleteTorrent(rdKey, id, true);

		console.log(`Successfully processed hash ${hash}`);
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
	const selectedFiles = torrentInfo.files.filter((file) => file.selected === 1);

	if (selectedFiles.length === 0 || selectedFiles.length !== torrentInfo.links.length) {
		console.error(
			`Error saving available torrent ${hash}: selectedFiles.length=${selectedFiles.length}, links.length=${torrentInfo.links.length}`
		);
		return;
	}

	await db.prisma.available.upsert({
		where: { hash },
		update: {
			imdbId,
			originalFilename: torrentInfo.original_filename,
			originalBytes: BigInt(torrentInfo.original_bytes),
			ended: new Date(torrentInfo.ended),
			files: {
				deleteMany: {},
				create: selectedFiles.map((file, index) => ({
					link: torrentInfo.links[index],
					file_id: file.id,
					path: file.path,
					bytes: BigInt(file.bytes),
				})),
			},
		},
		create: {
			hash,
			imdbId,
			filename: torrentInfo.filename,
			originalFilename: torrentInfo.original_filename,
			bytes: BigInt(torrentInfo.bytes),
			originalBytes: BigInt(torrentInfo.original_bytes),
			host: 'real-debrid.com',
			progress: torrentInfo.progress,
			status: torrentInfo.status,
			ended: new Date(torrentInfo.ended),
			files: {
				create: selectedFiles.map((file, index) => ({
					link: torrentInfo.links[index],
					file_id: file.id,
					path: file.path,
					bytes: BigInt(file.bytes),
				})),
			},
		},
	});
}

async function getSearchResults(imdbId: string): Promise<SearchResult[]> {
	const results = (await Promise.all([
		db.prisma.scraped.findFirst({
			where: { key: `movie:${imdbId}` },
		}),
		db.prisma.scrapedTrue.findFirst({
			where: { key: `movie:${imdbId}` },
		}),
	])) as unknown as DbResult[];

	return results
		.map((result) => result?.value)
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
