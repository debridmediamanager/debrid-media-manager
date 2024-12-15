import { getIntent } from '@/utils/intent';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { os, player, token, link } = req.query;
	const rdKey = token as string;
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const intent = await getIntent(
		rdKey,
		link as string,
		ipAddress,
		os as string,
		player as string
	);
	if (intent) {
		res.redirect(307, intent);
	} else {
		res.status(500).json({ error: `No intent found for ${link}` });
	}
};

export default handler;
