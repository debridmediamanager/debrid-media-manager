import { Repository } from '@/services/repository';
import { NextApiHandler } from 'next';

const db = new Repository();

const handler: NextApiHandler = async (req, res) => {
	const data = Array.from(new Set(await db.getRecentlyUpdatedContent()));

	res.status(200).json(data);
};

export default handler;
