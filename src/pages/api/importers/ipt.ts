import { Repository } from '@/services/repository';
import { computeHashFromTorrent } from '@/utils/extractHashFromTorrent';
import { NextApiRequest, NextApiResponse } from 'next';

interface ScrapeResponse {
	status: string;
	message?: string;
}

// Define a sleep function
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pdb = new Repository();
const processedIds = new Set<string>();

const extractDownloadLinks = (searchContent: string): string[] => {
	// delete everything before the string " Active Torrents"
	const start = searchContent.indexOf(' Active Torrents');
	searchContent = searchContent.substring(start);
	const linkRegex = /href="\/t\/(\d+)"/g;
	let match;
	const ids = [];
	while ((match = linkRegex.exec(searchContent)) !== null) {
		ids.push(match[1]);
	}
	return ids;
};

// TODO: Add a way to fetch torrents by imdb id

// Define a function to fetch Search page content, extract IDs, and fetch details for each ID
const fetchSearchPageAndDetails = async (
	searchPageUrl: string,
	uid: string,
	pass: string,
	mediaType: string,
	torrentPass: string
): Promise<void> => {
	try {
		const searchResponse = await fetch(searchPageUrl, {
			headers: {
				Cookie: `uid=${uid}; pass=${pass}; cf_clearance=wTlYiDj9LEPtosSbpxMSpV.k1QMAR3x8JAr.VIl_neY-1708541520-1.0-Af3JVtdBkbBIchjmZ9P1dcGjLe6aV8atETZnuHk8g17HFc41OzdkPD+QTIS71fDvfDI5NIfuGna2NrHhnKCfSl8=;`,
			},
		});
		console.log('Fetching search page url:', searchPageUrl);
		const searchContent = await searchResponse.text();
		const ids = extractDownloadLinks(searchContent);
		const scrapesMap = new Map<string, any>();
		for (const id of ids) {
			if (processedIds.has(id)) {
				continue;
			}
			const details = await iptGetDetails(uid, pass, torrentPass, id);
			if (!details.length) {
				continue;
			}
			if (mediaType === 'movie') {
				for (let i = 0; i < details.length; i++) {
					processedIds.add(details[i].id);
					let imdbId = details[i].imdb;
					if (!imdbId) {
						console.error('No IMDB, TMDB, or TVMaze ID', details[i]);
						continue;
					}
					const scrape = {
						title: details[i].name,
						fileSize: details[i].size,
						hash: details[i].hash.toLocaleLowerCase(),
					};
					if (scrapesMap.has(`movie:${imdbId}`)) {
						scrapesMap.get(`movie:${imdbId}`).push(scrape);
					} else {
						scrapesMap.set(`movie:${imdbId}`, [scrape]);
					}
				}
			} else if (mediaType === 'tv') {
				for (let i = 0; i < details.length; i++) {
					processedIds.add(details[i].id);
					let imdbId = details[i].imdb;
					if (!imdbId) {
						console.error('No IMDB, TMDB, or TVMaze ID', details[i]);
						continue;
					}
					let seasonNum: number | null = null;
					const seasonMatch =
						details[i].name.match(/S(\d{1,2})E?/i) ||
						details[i].name.match(/Season.?(\d{1,2})/i) ||
						details[i].name.match(/(\d{1,2})x\d{1,2}/i);

					if (seasonMatch && seasonMatch[1]) {
						seasonNum = parseInt(seasonMatch[1], 10);
					} else {
						console.warn('No season match, setting to 1', details[i].name);
						seasonNum = 1; // Default to season 1 if no match is found
					}
					const scrape = {
						title: details[i].name,
						fileSize: details[i].size,
						hash: details[i].hash.toLocaleLowerCase(),
					};
					if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
						scrapesMap.get(`tv:${imdbId}:${seasonNum}`).push(scrape);
					} else {
						scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [scrape]);
					}
				}
			}
		}
		scrapesMap.forEach(async (scrapes, key) => {
			const url = `https://debridmediamanager.com/${key
				.replaceAll(':', '/')
				.replaceAll('tv/', 'show/')}`;
			console.log(url, key, scrapes);
			await pdb.saveScrapedTrueResults(key, scrapes, true);
		});
	} catch (error) {
		console.error('An error occurred fetching search page url:', error);
	}
};

export const iptGetDetails = async (
	uid: string,
	pass: string,
	torrentPass: string,
	id: string
): Promise<IPTDetails[]> => {
	const url = `https://iptorrents.com/torrent.php?id=${id}`;
	const scrapes: IPTDetails[] = [];
	try {
		const response = await fetch(url, {
			headers: {
				Cookie: `uid=${uid}; pass=${pass}; cf_clearance=wTlYiDj9LEPtosSbpxMSpV.k1QMAR3x8JAr.VIl_neY-1708541520-1.0-Af3JVtdBkbBIchjmZ9P1dcGjLe6aV8atETZnuHk8g17HFc41OzdkPD+QTIS71fDvfDI5NIfuGna2NrHhnKCfSl8=;`,
			},
		});
		let text = await response.text();
		const nameRegexp = new RegExp(`download.php\/${id}\/(.*).torrent\">`, 'i');
		const nameMatch = text.match(nameRegexp) ?? [];
		const imdbMatch = text.match(/\/t\?q=(tt\d+)/) ?? [];
		if (imdbMatch.length != 2) {
			// console.error('No IMDB match', url);
			return [];
		}
		const sizeMatch = text.match(/Size: ([\d.]+\s[MGT]B) in </i);
		scrapes.push({
			id,
			imdb: imdbMatch[1],
			name: decodeURIComponent(nameMatch[1]) ?? '',
			size: sizeMatch
				? parseFloat(sizeMatch[1]) *
					(sizeMatch[1].endsWith('GB')
						? 1024
						: sizeMatch[1].endsWith('TB')
							? 1024 * 1024
							: 1)
				: 0,
			hash: await convertToHash(id, torrentPass),
		});

		const otherTorrents = [
			...(text.match(
				/download.php\/[^>]+\.torrent"><i class="fa fa\-download fa\-2x grn"><\/i><\/a><\/td><td>[^<]+<\/td>/g
			) ?? []),
		];
		for (let i = 0; i < otherTorrents.length; i++) {
			const torMatch = otherTorrents[i].match(/download.php\/(\d+)\/(.*).torrent\">/i) ?? [];
			const sizeMatch2 = otherTorrents[i].match(/>([\d.]+\s[MGT]B)</i);
			scrapes.push({
				id: torMatch[1],
				imdb: imdbMatch[1],
				name: decodeURIComponent(torMatch[2]) ?? '',
				size: sizeMatch2
					? parseFloat(sizeMatch2[1]) *
						(sizeMatch2[1].endsWith('GB')
							? 1024
							: sizeMatch2[1].endsWith('TB')
								? 1024 * 1024
								: 1)
					: 0,
				hash: await convertToHash(torMatch[1], torrentPass),
			});
		}
	} catch (e) {
		console.error('Error', id, e);
		return [];
	}
	return scrapes;
};

async function convertToHash(id: string, torrentPass: string): Promise<string> {
	if (!id) {
		return '';
	}
	let hash = await computeHashFromTorrent(
		`https://iptorrents.com/download.php/${id}/t.torrent?torrent_pass=${torrentPass}`
	);
	if (hash) {
		return hash;
	}
	return '';
}

// A looping function with sleep for periodic execution and stopping when encountering a specific ID
const startLoop = async (
	searchPageUrl: string,
	pageNum: number,
	uid: string,
	pass: string,
	mediaType: string,
	torrentPass: string,
	interval: number
) => {
	while (pageNum > 0) {
		let finalSearchUrl = searchPageUrl + pageNum;
		await fetchSearchPageAndDetails(finalSearchUrl, uid, pass, mediaType, torrentPass);
		await sleep(interval);
		pageNum--;
	}
};

interface IPTDetails {
	id: string;
	imdb: string;
	name: string;
	size: number;
	hash: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { mediaType, uid, pass, torrentPass } = req.query;
	// https://iptorrents.com/t?72;p=4478
	// https://iptorrents.com/t?73;p=11462
	let searchPageUrl = '';
	let lastPage = 0;
	if (mediaType === 'movie') {
		searchPageUrl = `https://iptorrents.com/t?72;p=`;
		lastPage = 4479;
	} else if (mediaType === 'tv') {
		searchPageUrl = `https://iptorrents.com/t?73;p=`;
		lastPage = 11463;
	}
	await startLoop(
		searchPageUrl,
		lastPage,
		uid as string,
		pass as string,
		mediaType as string,
		torrentPass as string,
		1000
	);
	res.status(200).json({
		status: 'success',
		message: 'Scraping completed or stopped at specified ID',
	});
	return;
}
