import axios from 'axios';
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
				`https://torrentio.strem.fun/sort=size%7Cqualityfilter=other,scr,cam,unknown/stream/movie/${imdbId}.json`
			);
			return response.data.streams.map(processStream);
		} else if (mediaType === 'tv') {
			// TODO
			const response = await axios.get(
				`https://torrentio.strem.fun/sort=size%7Cqualityfilter=other,scr,cam,unknown/stream/series/${imdbId}:1:3.json`
			);
			return response.data.streams.map(processStream);
		}
	} catch (error) {
		console.error('scrapeTorrentio page processing error', error);
	}
	return [];
}
