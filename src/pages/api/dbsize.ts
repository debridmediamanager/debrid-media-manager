import { NextApiHandler } from 'next';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis connection error', err));
redisClient.connect();

const handler: NextApiHandler = async (req, res) => {
	try {
		const size = await redisClient.DBSIZE();
		res.status(200).json({ size });
	} catch (err) {
        console.error(err);
		res.status(500).json({ error: err });
	}
};

export default handler;
