import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse } from '@/services/scrapeJobs';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const db = new PlanetScaleCache();
const torrentioUrl = (imdbId: string) =>
	`https://torrentio.strem.fun/sort=size%7Cqualityfilter=other,scr,cam,unknown/stream/movie/${imdbId}.json`;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	const { startFrom } = req.query;

	let imdbIds = await db.getAllImdbIds('movie');
	if (!imdbIds) {
		res.status(500).json({
			status: 'error',
			errorMessage: 'Something wrong with the database',
		});
		return;
	}
	let startFromHere = (startFrom as string) ?? '';
	while (true) {
		for (const imdbId of imdbIds) {
			if (startFromHere && imdbId !== startFromHere) continue;
			startFromHere = '';
			// show percentage
			const index = imdbIds.indexOf(imdbId);
			const percentage = Math.round((index / imdbIds.length) * 100);
			while (true) {
				try {
					const response = await axios.get(torrentioUrl(imdbId), {
						headers: {
							accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
							'accept-language': 'en-US,en;q=0.5',
							'accept-encoding': 'gzip, deflate, br',
							connection: 'keep-alive',
							'sec-fetch-dest': 'document',
							'sec-fetch-mode': 'navigate',
							'sec-fetch-site': 'same-origin',
							'sec-fetch-user': '?1',
							'upgrade-insecure-requests': '1',
							'user-agent': new UserAgent().toString(),
						},
					});
					const torrentioLinks = response.data.streams.map(processStream);
					console.log(
						`[movieupdater] ${imdbId} has ${torrentioLinks.length} links ${percentage}% (${index}/${imdbIds.length})`
					);
					await db.saveScrapedTrueResults(`movie:${imdbId}`, torrentioLinks, true);
					break;
				} catch (e) {
					console.log(`[movieupdater] ${imdbId} failed (${e}), retrying...`);
					await new Promise((resolve) => setTimeout(resolve, 600000));
					continue;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 10000));
		}
		startFromHere = '';
	}
}

function processStream(item: any): ScrapeSearchResult {
	// Extract the name
	const nameMatch = item.title.match(/(.+?)\n/);
	const name = nameMatch ? nameMatch[1] : '';

	// Extract the size
	const sizeMatch = item.title.match(/💾\s+(\d+(?:\.\d+)?)\s+(GB|MB)/);
	let size = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
	const unit = sizeMatch ? sizeMatch[2] : '';

	// If the size is in MB, convert it to GB
	if (unit === 'GB') {
		size *= 1024;
	}

	return {
		title: name,
		fileSize: size,
		hash: item.infoHash,
	};
}
