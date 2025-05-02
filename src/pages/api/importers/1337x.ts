import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { getMdblistClient } from '@/services/mdblistClient';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { Repository } from '@/services/repository';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();
const mdblistClient = getMdblistClient();
const HOST_1337X = 'https://1337x.to';
// const HOST_1337X = 'https://1337x.st';
// const HOST_1337X = 'https://x1337x.ws'
// const HOST_1337X = 'https://x1337x.eu'
// const HOST_1337X = 'https://x1337x.se'
// const HOST_1337X = 'https://1337x.so'
// const HOST_1337X = 'https://1337x.unblockit.dad'
// const HOST_1337X = 'https://1337x.unblockninja.com'
// const HOST_1337X = 'https://1337x.ninjaproxy1.com'
// const HOST_1337X = 'https://1337x.proxyninja.org'
// const HOST_1337X = 'https://1337x.torrentbay.st'
const x1337home = () => `${HOST_1337X}/home/`;
const x1337library = (page: number) => `${HOST_1337X}/movie-library/${page}/`;
const x1337movie = (tmdbId: number) => `${HOST_1337X}/movie/${tmdbId}/Seven-Lucky-Gods-2014/`;
const x1337torrent = (torrentId: string) =>
	`${HOST_1337X}/torrent/${torrentId}/Seven-Lucky-Gods-2014-1080p-YTS-YIFY/`;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const x1337config = {
		headers: {
			cookie: 'cf_clearance=nah1u7n25DaX.Lsy4xaNizGzLicl.NAtkSx3sFbI098-1709329857-1.0.1.1-qPs.BCIDJ_fDU4OoXXOq0RriSXqxgP0jEWKxdEBodawsWhjoZYZvlseCSWIOw3PZwTMjQIXtNPstVqkoJ4i7qg; uid=260929; pass=77e9ebc60716eafd93f3f87ba61d8b87',
			'user-agent':
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
		},
	};
	const tmdbIds: number[] = [];
	try {
		for (let i = 1; i <= 300; i++) {
			const response = await axios.get(x1337library(i), x1337config);
			// capture all by regex <a href="/movie/347882/ and add to tmdbIds
			const matches = response.data.match(/<a href="\/movie\/(\d+)\/[^"]+/g);
			if (matches) {
				for (const match of matches) {
					const tmdbId = match.match(/<a href="\/movie\/(\d+)\/[^"]+/)[1];
					// push if not already in array
					if (!tmdbIds.includes(tmdbId)) {
						tmdbIds.push(tmdbId);
					}
				}
			}
		}
		console.log(`[1337x] found ${tmdbIds.length} movies`, tmdbIds.join(', '));
	} catch (e) {
		console.log(`[1337x] library page failed (${e})`);
		await new Promise((resolve) => setTimeout(resolve, 60000));
		await axios.get(x1337home(), x1337config);
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}
	for (const tmdbId of tmdbIds) {
		// show percentage
		const index = tmdbIds.indexOf(tmdbId);
		const percentage = Math.round((index / tmdbIds.length) * 100);
		const torrentIds: string[] = [];
		const mdbResp = await mdblistClient.getInfoByTmdbId(tmdbId);
		let imdbId = mdbResp.data.imdbid ?? '';
		if (!imdbId) {
			imdbId = `tmdb-${tmdbId}`;
		}
		try {
			while (true) {
				try {
					const response = await axios.get(x1337movie(tmdbId), x1337config);
					// // capture all by regex <a href="/torrent/347882/ and add to torrentIds
					const matches = response.data.match(/<a href="\/torrent\/(\d+)\/[^"]+/g);
					if (matches) {
						for (const match of matches) {
							const torrentId = match.match(/<a href="\/torrent\/(\d+)\/[^"]+/)[1];
							torrentIds.push(torrentId);
						}
					}
					await new Promise((resolve) => setTimeout(resolve, 500));
					break;
				} catch (e) {
					console.log(`[1337x] ${x1337movie(tmdbId)} failed (${e})`);
					await new Promise((resolve) => setTimeout(resolve, 60000));
					await axios.get(x1337home(), x1337config);
					await new Promise((resolve) => setTimeout(resolve, 5000));
				}
			}
			const scrapes: ScrapeSearchResult[] = [];
			for (const torrentId of torrentIds) {
				while (true) {
					try {
						const response = await axios.get(x1337torrent(torrentId), x1337config);
						// title: <h1> Seven Lucky Gods (2014) [1080p] [YTS] [YIFY] </h1>
						// size: <strong>Total size</strong> <span>1.6 GB</span> </li>
						// hash: <strong>Infohash :</strong> <span>2D6DAB851D9D023B7D85374A16A4DFA2B8ADEF23</span>
						// scrape by regex
						const titleMatch = response.data.match(/<h1>([^<]+)<\/h1>/);
						const sizeMatch = response.data.match(
							/<strong>Total size<\/strong> <span>([^<]+)<\/span>/
						);
						// compute for size in megabytes number, so consider sizeMatch if TB or GB
						let sizeNumber = parseFloat(sizeMatch[1].replace(',', '') ?? '0');
						let fileSize = 0;
						if (sizeMatch[1].endsWith('TB')) {
							fileSize = sizeNumber * 1024 * 1024;
						} else if (sizeMatch[1].endsWith('GB')) {
							fileSize = sizeNumber * 1024;
						} else if (sizeMatch[1].endsWith('MB')) {
							fileSize = sizeNumber;
						} else {
							continue;
						}
						const hashMatch = response.data.match(
							/<strong>Infohash :<\/strong> <span>([^<]+)<\/span>/
						);
						const scrape = {
							title: titleMatch ? titleMatch[1].trim() : '',
							fileSize,
							hash: hashMatch ? hashMatch[1].trim().toLowerCase() : '',
						};
						scrapes.push(scrape);
						await new Promise((resolve) => setTimeout(resolve, 500));
						break;
					} catch (e) {
						console.log(
							`[1337x] ${x1337torrent(torrentId)} failed (${e}), trying again`
						);
						await new Promise((resolve) => setTimeout(resolve, 60000));
						await axios.get(x1337home(), x1337config);
						await new Promise((resolve) => setTimeout(resolve, 5000));
					}
				}
			}

			if (scrapes.length === 0) {
				console.log(`[1337x] ${x1337movie(tmdbId)} has no links`);
				continue;
			}

			console.log(
				`[1337x] ${tmdbId} has ${scrapes.length} links ${percentage}% (${index}/${tmdbIds.length})`
			);

			const url = `https://debridmediamanager.com/movie/${imdbId}`;
			await db.saveScrapedTrueResults(`movie:${imdbId}`, scrapes, true);
			console.log(url, scrapes);
		} catch (e) {
			console.log(`[1337x] ${x1337movie(tmdbId)} failed (${e})`);
		}
	}
}
