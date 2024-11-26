import { PlanetScaleCache } from '@/services/planetscale';
import { getToken, unrestrictLink } from '@/services/realDebrid';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export async function HEAD(req: NextApiRequest, res: NextApiResponse) {
	res.status(200).end();
}

// Cast a link
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, link } = req.query;

	const profile = await db.getCastProfile(userid as string);
	if (!profile) {
		return res.status(401).json({ error: 'Go to DMM and connect your RD account' });
	}
	const response = await getToken(
		profile.clientId,
		profile.clientSecret,
		profile.refreshToken,
		true
	);
	if (!response) {
		return res.status(500).json({ error: 'Go to DMM and connect your RD account' });
	}
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const unrestrict = await unrestrictLink(
		response.access_token,
		`https://real-debrid.com/d/${link}`,
		ipAddress,
		true
	);
	if (!unrestrict) {
		return res.status(500).json({ error: 'Failed to unrestrict link' });
	}

	res.redirect(unrestrict.download);
}
