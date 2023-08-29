import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiHandler } from 'next';

const db = new PlanetScaleCache();

const handler: NextApiHandler = async (req, res) => {
    const { imdbId } = req.query;

    if (!imdbId || !(typeof imdbId === 'string')) {
        res.status(400).json({ errorMessage: 'Missing "imdbId" query parameter' });
        return;
    }

    try {
        const searchResults = await db.getScrapedResults<any[]>(`movie:${imdbId.toString().trim()}`);
        if (searchResults) {
            res.status(200).json({ results: searchResults });
            return;
        }

        res.status(204).json({ results: [] });
    } catch (error: any) {
        console.error('encountered a db issue', error);
        res.status(500).json({ errorMessage: error.message });
    }
};

export default handler;
