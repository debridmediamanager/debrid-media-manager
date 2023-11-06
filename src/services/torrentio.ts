import axios from 'axios';
import UserAgent from 'user-agents';
import { ScrapeSearchResult } from './mediasearch';

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

export async function scrapeTorrentio(
	imdbId: string,
	mediaType: 'tv' | 'movie'
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching Torrentio: ${imdbId}`);
	try {
		if (mediaType === 'movie') {
			const response = await axios.get(
				`https://torrentio.strem.fun/sort=size%7Cqualityfilter=other,scr,cam,unknown/stream/movie/${imdbId}.json`,
				{
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
				}
			);
			return response.data.streams.map(processStream);
		} else if (mediaType === 'tv') {
			// TODO
			const response = await axios.get(
				`https://torrentio.strem.fun/sort=size%7Cqualityfilter=other,scr,cam,unknown/stream/series/${imdbId}:1:3.json`,
				{
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
				}
			);
			return response.data.streams.map(processStream);
		}
	} catch (error) {
		console.error('scrapeTorrentio page processing error', error);
	}
	return [];
}
