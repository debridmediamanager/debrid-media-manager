import { unrestrictLink } from '@/services/realDebrid';
import { Repository } from '@/services/repository';
import { extractToken } from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

// Unrestrict and play a link
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, link } = req.query;
	const token = extractToken(req);

	if (!token || typeof userid !== 'string' || typeof token !== 'string' || typeof link !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid or missing "userid", "link" or "token" parameter',
		});
		return;
	}

	try {
		const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
		const unrestrict = await unrestrictLink(
			token,
			`https://real-debrid.com/d/${link.substring(0, 13)}`,
			ipAddress,
			true
		);
		if (!unrestrict) {
			return res.status(500).json({ error: 'Failed to unrestrict link' });
		}

		res.redirect(unrestrict.download);
	} catch (error: any) {
		console.error(
			'Failed to play link:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to play link' });
	}
}
