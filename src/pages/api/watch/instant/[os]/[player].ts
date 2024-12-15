import { getInstantIntent } from '@/utils/intent';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { os, player, token, hash, fileId } = req.query;
	const rdKey = token as string;
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const selectedFileId = parseInt(fileId as string, 10);
	const intent = await getInstantIntent(
		rdKey,
		hash as string,
		selectedFileId,
		ipAddress,
		os as string,
		player as string
	);
	if (intent) {
		res.redirect(307, intent);
	} else {
		res.status(500).json({ error: `No intent found for ${hash}` });
	}
};

export default handler;
