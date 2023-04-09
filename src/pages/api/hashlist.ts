// pages/api/shorturl.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { Octokit } from '@octokit/rest'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.status(405).json({ message: 'Method not allowed' });
	}
	// Generate short URL for the given URL
	const { url } = req.body;

	if (!url) {
		res.status(400).json({ message: 'URL is required' });
		return;
	}

	const uuid = uuidv4();

	res.status(200).json({ shortUrl: `https://hashlists.debridmanager.com/${uuid}.html` });
}
