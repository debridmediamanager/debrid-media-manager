import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiHandler } from 'next';

const cache = new PlanetScaleCache();

const handler: NextApiHandler = async (req, res) => {
	try {
		const contentSizeRaw: any = await cache.prisma.$queryRaw`Select count(*) as contentSize from Scraped WHERE Scraped.key LIKE 'movie:%' OR Scraped.key LIKE 'tv:%';`;
		const processingRaw: any = await cache.prisma.$queryRaw`Select count(*) as processing from Scraped WHERE Scraped.key LIKE 'processing:%';`;
		const requestedRaw: any = await cache.prisma.$queryRaw`Select count(*) as requested from Scraped WHERE Scraped.key LIKE 'requested:%';`;
		const contentSize = parseInt(contentSizeRaw[0].contentSize);
		const processing = parseInt(processingRaw[0].processing);
		const requested = parseInt(requestedRaw[0].requested);

		res.status(200).json({ contentSize, processing, requested });
	} catch (err: any) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
};

export default handler;
