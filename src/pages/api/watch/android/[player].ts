import { unrestrictLink } from '@/services/realDebrid';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { player, token, link } = req.query;
	const resp = await unrestrictLink(
		token as string,
		link as string,
		(req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress,
		true
	);
	res.redirect(
		307,
		`intent://${resp.download.replace(
			'https://',
			''
		)}#Intent;type=video/any;scheme=https;package=${player};end`
	);
};

export default handler;
