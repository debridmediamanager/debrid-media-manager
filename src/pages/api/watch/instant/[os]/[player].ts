import { getClientIpFromRequest } from '@/utils/clientIp';
import { getInstantIntent, isWatchService } from '@/utils/intent';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { os, player, token, hash, fileId, fileName, service } = req.query;
	const key = token as string;
	const ipAddress = getClientIpFromRequest(req);
	const selectedFileId = parseInt(fileId as string, 10);
	const result = await getInstantIntent(
		key,
		hash as string,
		selectedFileId,
		ipAddress,
		os as string,
		player as string,
		isWatchService(service) ? service : 'rd',
		typeof fileName === 'string' && fileName ? fileName : undefined
	);
	if (result.intent) {
		res.redirect(307, result.intent);
	} else if (result.temporary) {
		// Real-Debrid refused the add twice, a pause apart: try again later.
		res.setHeader('Retry-After', '120');
		res.status(503).json({ error: result.error });
	} else {
		res.status(500).json({ error: result.error || `No intent found for ${hash}` });
	}
};

export default handler;
