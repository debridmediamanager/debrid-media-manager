import { unrestrictLink } from '@/services/realDebrid';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const { token, link } = req.query;
	const resp = await unrestrictLink(
		token as string,
		link as string,
		(req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress,
		true
	);
	res.redirect(
		307,
		`intent://${resp.download.replace('https://', '')}#Intent;type=video/any;scheme=https;end`
	);
};

export default handler;
