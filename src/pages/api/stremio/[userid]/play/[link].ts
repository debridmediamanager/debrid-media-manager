import { Repository } from '@/services/planetscale';
import { getToken, unrestrictLink } from '@/services/realDebrid';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

export async function HEAD(req: NextApiRequest, res: NextApiResponse) {
	res.status(200).end();
}

// Unrestrict and play a link
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, link } = req.query;
	if (typeof userid !== 'string' || typeof link !== 'string') {
		return res.status(400).json({ error: 'Invalid "userid" or "link" query parameter' });
	}

	const profile = await db.getCastProfile(userid as string);
	if (!profile) {
		return res.status(401).json({ error: 'Go to DMM and connect your RD account' });
	}
	const response = await getToken(
		profile.clientId,
		profile.clientSecret,
		profile.refreshToken,
		false
	);
	if (!response) {
		return res.status(500).json({ error: 'Go to DMM and connect your RD account' });
	}
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const unrestrict = await unrestrictLink(
		response.access_token,
		`https://real-debrid.com/d/${link.substring(0, 13)}`,
		ipAddress,
		false
	);
	if (!unrestrict) {
		return res.status(500).json({ error: 'Failed to unrestrict link' });
	}

	res.redirect(unrestrict.download);
}
