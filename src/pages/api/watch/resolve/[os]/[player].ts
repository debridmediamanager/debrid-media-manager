import { getClientIpFromRequest } from '@/utils/clientIp';
import { getInstantIntent, getIntent, isWatchService } from '@/utils/intent';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

/**
 * Resolves a player intent without putting the debrid key in a URL.
 *
 * The GET routes next door take `token` as a query parameter, so the key ends up
 * in the address bar of the tab that opens and in every access log between here
 * and the browser. This takes it in the body and hands the intent back as JSON
 * for the caller to navigate to.
 *
 * Which of the two resolvers runs is decided by whether the caller already holds
 * a service link: a library torrent's row does, a search result does not.
 */
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		res.status(405).json({ error: 'Method not allowed' });
		return;
	}

	res.setHeader('Cache-Control', 'no-store');

	const { os, player } = req.query;
	const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {};
	const { token, hash, fileId, fileName, link, service } = body;

	if (!token || typeof token !== 'string') {
		res.status(400).json({ error: 'Missing token' });
		return;
	}
	if (!link && !hash) {
		res.status(400).json({ error: 'Missing hash' });
		return;
	}

	const watchService = isWatchService(service) ? service : 'rd';
	const ipAddress = getClientIpFromRequest(req);

	const result = link
		? await getIntent(token, link, ipAddress, os as string, player as string, watchService)
		: await getInstantIntent(
				token,
				hash,
				parseInt(fileId, 10),
				ipAddress,
				os as string,
				player as string,
				watchService,
				typeof fileName === 'string' && fileName ? fileName : undefined
			);

	if (result.intent) {
		res.status(200).json({ intent: result.intent });
	} else {
		res.status(500).json({ error: result.error || `No intent found for ${hash ?? link}` });
	}
};

const safeParse = (value: string) => {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

export default handler;
