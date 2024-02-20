import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const pdb = new PlanetScaleCache();

const fetchContent = async (milkieToken: string): Promise<void> => {
	console.log('Fetching content');
	let nullCount = 0;
	let totalCount = 0;

	let i = 30960;
	while (i > 0) {
		try {
			console.log('Fetching', i);
			const response = await fetch(`https://milkie.cc/api/v1/torrent_groups/${i}/versions`, {
				headers: {
					Authorization: `Bearer ${milkieToken}`,
				},
			});
			const results = await response.json();
			if (results === null) {
				// console.error('Null response', i);
				nullCount++;
			} else {
				// show progress every 10, say X left
				if (i % 5 === 0) {
					console.log(`>>>>>>>>>>> ${i} left`);
					console.log(`Total count: ${totalCount}`);
				}
				nullCount = 0;
				// get all ids and get details
				const scrapesMap = new Map<string, any>();
				let mediaType = 'unknown';
				let imdbId: string | null = null;
				for (const result of results) {
					// console.log('Fetching', result.id);
					const details = await milkieGetDetails(milkieToken, result.id);
					if (details === null) {
						continue;
					}
					imdbId = details.torrent.externals.imdb || imdbId;
					if (!imdbId) {
						imdbId = details.torrent.externals.tmdb
							? `tmdb-${details.torrent.externals.tmdb.toString()}`
							: null;
					}
					if (!imdbId) {
						imdbId = details.torrent.externals.tvmaze
							? `tvmaze-${details.torrent.externals.tvmaze.toString()}`
							: null;
					}
					if (!imdbId) {
						// console.error('No IMDB, TMDB, or TVMaze ID', details.torrent);
						continue;
					}
					if (details.torrent.category === 1) {
						mediaType = 'movie';
						// // movie
						// console.log('Movie');
						// console.log('Release name', details.torrent.releaseName);
						// console.log('Size', details.torrent.size);
						// console.log('Hash', details.torrent.infoHash);
						// console.log('IMDB', details.torrent.externals.imdb);
						const scrape = {
							title: details.torrent.releaseName,
							fileSize: details.torrent.size / 1024 / 1024,
							hash: details.torrent.infoHash.toLocaleLowerCase(),
						};
						if (scrapesMap.has(`movie:${imdbId}`)) {
							scrapesMap.get(`movie:${imdbId}`).push(scrape);
						} else {
							scrapesMap.set(`movie:${imdbId}`, [scrape]);
						}
					} else if (details.torrent.category === 2) {
						mediaType = 'tv';
						// // tv
						// console.log('TV');
						// console.log('Release name', details.torrent.releaseName);
						// console.log('Size', details.torrent.size);
						// console.log('Hash', details.torrent.infoHash);
						// console.log('IMDB', details.torrent.externals.imdb);
						let seasonNum: number | null = null;
						const seasonMatch =
							details.torrent.releaseName.match(/S(\d{1,2})E?/i) ||
							details.torrent.releaseName.match(/Season\s?(\d{1,2})/i) ||
							details.torrent.releaseName.match(/(\d{1,2})x\d{1,2}/i);

						if (seasonMatch && seasonMatch[1]) {
							seasonNum = parseInt(seasonMatch[1], 10);
						} else {
							console.warn(
								'No season match, setting to 1',
								details.torrent.releaseName
							);
							seasonNum = 1; // Default to season 1 if no match is found
						}
						const scrape = {
							title: details.torrent.releaseName,
							fileSize: details.torrent.size / 1024 / 1024,
							hash: details.torrent.infoHash.toLocaleLowerCase(),
						};
						if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
							scrapesMap.get(`tv:${imdbId}:${seasonNum}`).push(scrape);
						} else {
							scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [scrape]);
						}
					} else {
						console.error('Unknown category', details.torrent);
					}
					// sleep for 1/10 second
					// await new Promise((resolve) => setTimeout(resolve, 100));
				}
				// iterate over keys of scrapesMap and save
				scrapesMap.forEach(async (scrapes, key) => {
					const url = `https://debridmediamanager.com/${key
						.replaceAll(':', '/')
						.replaceAll('tv/', 'show/')}`;
					console.log(url, key, scrapes);
					await pdb.saveScrapedTrueResults(key, scrapes, true);
					totalCount += scrapes.length;
				});
			}
		} catch (e) {
			console.error('Error', i, e);
		}
		i--;
		// sleep for 1/10 second
		// await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

export const milkieGetDetails = async (
	milkieToken: string,
	id: string
): Promise<MilkieTorrentResponse | null> => {
	// https://milkie.cc/api/v1/torrents/${id}
	try {
		const response = await fetch(`https://milkie.cc/api/v1/torrents/${id}`, {
			headers: {
				Authorization: `Bearer ${milkieToken}`,
			},
		});
		return await response.json();
	} catch (e) {
		console.error('Error', id, e);
		return null;
	}
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { token } = req.query;
	await fetchContent(token as string);
	res.status(200).json({ status: 'success' });
	return;
}

export interface MilkieTorrentResponse {
	torrent: Torrent;
}

interface Torrent {
	id: string;
	releaseName: string;
	category: number;
	createdAt: string;
	size: number;
	files: number;
	downloaded: number;
	seeders: number;
	partialSeeders: number;
	leechers: number;
	infoHash: string;
	verified: boolean;
	metadata: Metadata;
	metainfo: Metainfo;
	nfo: string;
	groupId: number;
	comments: number;
	externals: Externals;
	versions: number;
}

interface Metadata {
	screenshots: Screenshot[];
	video: Video;
	audio: Audio[];
	subtitles: Subtitle[];
	medium: string;
}

interface Screenshot {
	thumbnail: string;
	original: string;
}

interface Video {
	bitrate: number;
	codec: string;
	fps: number;
	resX: number;
	resY: number;
	resName: string;
}

interface Audio {
	language: string;
	bitrate: number;
	channels: number;
	codec: string;
}

interface Subtitle {
	language: string;
	codec: string;
}

interface Metainfo {
	root: string;
	files: MetaFile[];
}

interface MetaFile {
	size: number;
	path: string[];
}

interface Externals {
	imdb: null | string;
	tmdb: null | number;
	tvmaze: null | number;
}
