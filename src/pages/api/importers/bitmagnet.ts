import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

const pool = new Pool({
	host: 'tor-new.drum-dab.ts.net',
	database: 'bitmagnet',
	user: 'postgres',
	password: 'postgres',
	port: 5432,
});

const fetchMovies = async () => {
	const query = `
        SELECT
            tc.id, ca.value, t.name, t.size
        FROM
            torrent_contents tc
        JOIN
            content_attributes ca ON tc.content_id = ca.content_id
            AND ca.content_type = tc.content_type
        JOIN
            torrents t ON tc.info_hash = t.info_hash
        WHERE
            tc.content_type = 'movie'
            AND ca.source = 'imdb'
        ORDER BY
            tc.created_at DESC
		LIMIT 500;
    `;

	try {
		const client = await pool.connect();
		const result = await client.query(query);
		let i = 0;
		for (const row of result.rows) {
			console.log(`[${i}/${result.rows.length}] ${row.name} ${row.value}`);
			const hash = row.id.split(':')[0];

			// let saved = await db.getScrapedTrueResults<ScrapeSearchResult[]>(`movie:${row.value}`);
			// if (!saved || saved.length === 0) {
			// 	saved = [];
			// }

			// await db.deleteScrapedTrue(row.value);

			// saved.splice(
			// 	saved.findIndex((s) => s.hash === hash),
			// 	1
			// );
			// console.log(row); // Process each row here
			const scrape = {
				title: row.name,
				fileSize: parseInt(row.size) / 1024 / 1024,
				hash,
			};
			// saved.push(scrape);
			await db.saveScrapedTrueResults(`movie:${row.value}`, [scrape], true);
			i++;
		}

		client.release();
	} catch (error) {
		console.error('Error executing query', error);
	}
};

const fetchShows = async () => {
	const query = `
        SELECT
            tc.id, ca.value, t.name, t.size, tc.episodes as seasons
        FROM
            torrent_contents tc
        JOIN
            content_attributes ca ON tc.content_id = ca.content_id
            AND ca.content_type = tc.content_type
        JOIN
            torrents t ON tc.info_hash = t.info_hash
        WHERE
            tc.content_type = 'tv_show'
            AND ca.source = 'imdb'
        ORDER BY
            tc.created_at DESC
		LIMIT 500;
    `;

	try {
		const client = await pool.connect();
		const result = await client.query(query);
		let i = 0;
		for (const row of result.rows) {
			// console.log(row); // Process each row here
			// {
			// id: 'ba3177631b9094b03d4a8f4ad5b57157e034d285:tv_show:tmdb:36406',
			// value: 'tt4834194',
			// name: '[DragsterPS] Yu-Gi-Oh! S03 [480p] [Multi-Audio] [English Subs]',
			// size: '18256091070',
			// seasons: { '3': {} }
			// }
			console.log(`[${i}/${result.rows.length}] ${row.name}`);
			const promises: Promise<void>[] = [];
			Object.keys(row.seasons).map((season): void => {
				const scrape = {
					title: row.name,
					fileSize: parseInt(row.size) / 1024 / 1024,
					hash: row.id.split(':')[0],
				};
				promises.push(
					db.saveScrapedTrueResults(`tv:${row.value}:${season}`, [scrape], true)
				);
			});
			await Promise.all(promises);
			i++;
		}

		client.release();
	} catch (error) {
		console.error('Error executing query', error);
	}
};

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { mediaType } = req.query;
	if (mediaType === 'movie') {
		await fetchMovies();
	} else if (mediaType === 'tv') {
		await fetchShows();
	} else {
		while (true) {
			await fetchMovies();
			await fetchShows();
			await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 5));
		}
	}
	res.status(200).json({ status: 'success' });
	return;
}
