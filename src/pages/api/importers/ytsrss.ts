import { Repository } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

interface ScrapeResponse {
	status: string;
	message?: string;
}

// Define a sleep function
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pdb = new Repository();

const extractSlugs = (rssContent: string): string[] => {
	const linkRegex = /<link>https:\/\/yts.mx\/movies\/(.*)<\/link>/g;
	let match;
	const slugs = new Set<string>();
	while ((match = linkRegex.exec(rssContent)) !== null) {
		slugs.add(match[1]);
	}
	return Array.from(slugs);
};

// Define a function to fetch RSS content, extract IDs, and fetch details for each ID
const fetchRssAndDetails = async (rssUrl: string, lastSlug: string): Promise<string> => {
	try {
		const rssResponse = await fetch(rssUrl);
		const rssContent = await rssResponse.text();
		const slugs = extractSlugs(rssContent);
		const scrapesMap = new Map<string, any>();
		for (const slug of slugs) {
			if (slug === lastSlug) {
				console.log('Encountered previously processed slug, stopping...');
				break;
			}
			const details = await ytsGetDetails(slug);
			if (details === null) {
				continue;
			}
			for (const torrent of details.torrents) {
				const scrape = {
					title: torrent.title,
					fileSize: torrent.size,
					hash: torrent.hash.toLocaleLowerCase(),
				};
				if (scrapesMap.has(`movie:${details.imdbId}`)) {
					scrapesMap.get(`movie:${details.imdbId}`).push(scrape);
				} else {
					scrapesMap.set(`movie:${details.imdbId}`, [scrape]);
				}
			}
		}
		scrapesMap.forEach(async (scrapes, key) => {
			const url = `https://debridmediamanager.com/${key.replaceAll(':', '/')}`;
			console.log(url, key, scrapes);
			await pdb.saveScrapedTrueResults(key, scrapes, true);
		});
		return slugs[0]; // Return the most recent ID to track it
	} catch (error) {
		console.error('An error occurred fetching rss link:', error);
		return '';
	}
};

const ytsGetDetails = async (slug: string): Promise<YtsDetails | null> => {
	try {
		const response = await fetch(`https://yts.mx/movies/${slug}`);
		const text = await response.text();

		const imdbMatch = text.match(/\/title\/(tt\d+)/);
		if (!imdbMatch) {
			console.error('No IMDB ID found for', slug);
			return null;
		}

		const torrents: YtsTorrent[] = [];
		const torrentDivs = text.split('<div class="modal-torrent">');

		for (const div of torrentDivs.slice(1)) {
			// Skip the first div
			const magnetMatch = div.match(/magnet:\?xt=urn:btih:([A-F0-9]+)/i);
			const dnMatch = div.match(/dn=([^&]+)/);
			const sizeMatch = div.match(/File size<\/p>\s*<p class="quality-size">([\d.]+ [GM]B)/);

			if (magnetMatch && dnMatch && sizeMatch) {
				const hash = magnetMatch[1].toLowerCase();
				const decodedTitle = decodeURIComponent(dnMatch[1]).replaceAll('+', ' ');
				const sizeString = sizeMatch[1];
				const sizeInMB = sizeString.endsWith('GB')
					? parseFloat(sizeString) * 1024
					: parseFloat(sizeString);

				torrents.push({ hash, title: decodedTitle, size: sizeInMB });
			}
		}
		return {
			imdbId: imdbMatch[1],
			torrents,
		};
	} catch (error) {
		console.error('An error occurred fetching details:', error);
		return null;
	}
};

interface YtsTorrent {
	title: string;
	size: number;
	hash: string;
}

interface YtsDetails {
	imdbId: string;
	torrents: YtsTorrent[];
}

// A looping function with sleep for periodic execution and stopping when encountering a specific ID
const startLoop = async (rssUrl: string, interval: number, stopAtId: string) => {
	let lastSlug = stopAtId;
	while (true) {
		const newLastSlug = await fetchRssAndDetails(rssUrl, lastSlug);
		lastSlug = newLastSlug;
		await sleep(interval);
	}
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const rssUrl = `https://yts.mx/rss`;
	await startLoop(rssUrl, 300000, '');
	res.status(200).json({
		status: 'success',
		message: 'Scraping completed or stopped at specified ID',
	});
	return;
}
