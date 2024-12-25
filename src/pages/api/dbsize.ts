import { Repository } from '@/services/repository';
import { NextApiHandler } from 'next';

const cache = new Repository();

const handler: NextApiHandler = async (req, res) => {
	try {
		const [contentSize, processing, requested] = await Promise.all([
			cache.getContentSize(),
			cache.getProcessingCount(),
			cache.getRequestedCount(),
		]);

		res.status(200).json({ contentSize, processing, requested });
	} catch (err: any) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
};

export default handler;
