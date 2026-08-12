import { getClientIpFromRequest } from '@/utils/clientIp';
import { getIntent, isWatchService } from '@/utils/intent';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { os, player, token, link, service } = req.query;
	const key = token as string;
	const ipAddress = getClientIpFromRequest(req);
	const result = await getIntent(
		key,
		link as string,
		ipAddress,
		os as string,
		player as string,
		isWatchService(service) ? service : 'rd'
	);
	if (result.intent) {
		res.redirect(307, result.intent);
	} else {
		res.status(500).json({ error: result.error || `No intent found for ${link}` });
	}
};

export default handler;
