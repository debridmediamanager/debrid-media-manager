import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';
import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';

const pdb = new PlanetScaleCache();

// Define a type for the row structure
interface MovieRow {
	id: number;
	hash: string;
	title: string;
	dt: string;
	cat: string;
	size: number;
	imdb: string;
}

// Initialize and open the SQLite database
const initDB = async (): Promise<Database> => {
	return open({
		filename: './rarbg_db.sqlite',
		driver: sqlite3.Database,
	});
};

const fetchMovies = async (): Promise<void> => {
	console.log('Fetching movies');
	const db = await initDB();

	const query = `
		SELECT
			id, hash, title, dt, cat, size, imdb
		FROM
			items
		WHERE
			cat LIKE 'movies_%' AND imdb IS NOT NULL
		ORDER BY
			dt DESC;
    `;

	try {
		const rows = await db.all<MovieRow[]>(query);
		console.log(`Found ${rows.length} movies`);
		let i = 0;
		for (const row of rows) {
			console.log(`[${i}/${rows.length}] ${row.title} ${row.imdb}`);
			// Convert hash to lowercase
			const hashLower = row.hash.toLowerCase();
			const scrape = {
				title: row.title,
				fileSize: row.size / 1024 / 1024,
				hash: hashLower,
			};
			await pdb.saveScrapedTrueResults(`movie:${row.imdb}`, [scrape], true);
			i++;
		}
	} catch (error) {
		console.error('Error executing query', error);
	} finally {
		await db.close();
	}
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	await fetchMovies();
	res.status(200).json({ status: 'success' });
	return;
}
