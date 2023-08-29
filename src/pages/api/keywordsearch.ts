import { PlanetScaleCache } from '@/services/planetscale';
import axios from 'axios';
import { NextApiHandler } from 'next';

const mdblistKey = process.env.MDBLIST_KEY;
const searchMdb = (keyword: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&s=${keyword}`;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
const db = new PlanetScaleCache();

const handler: NextApiHandler = async (req, res) => {
    const { keyword } = req.query;

    if (!keyword || !(typeof keyword === 'string')) {
        res.status(400).json({ status: 'error', errorMessage: 'Missing "keyword" query parameter' });
        return;
    }

    try {
        const searchResults = await db.getSearchResults<any[]>(keyword.toString().trim());
        if (searchResults) {
            res.status(200).json({ results: searchResults.filter(r => r.imdbid) });
            return;
        }

        const searchResponse = await axios.get(searchMdb(keyword.toString().trim()));
        const results = ([...searchResponse.data.search]).filter((result: any) => result.imdbid);

        for (let i = 0; i < results.length; i++) {
            if (results[i].type === 'show') {
                const showResponse = await axios.get(getMdbInfo(results[i].imdbid));
                const seasons = showResponse.data.seasons.filter((season: any) => season.season_number > 0)
                    .map((season: any) => {
                        return season.season_number;
                    });
                results[i].season_count = Math.max(...seasons);
            }
        }

        console.log('search results', results.length);

        await db.saveSearchResults(keyword.toString().trim(), results);

        res.status(200).json({ results });
    } catch (error: any) {
        console.error('encountered a search issue', error);
        res.status(500).json({ status: 'error', errorMessage: error.message });
    }
};

export default handler;
