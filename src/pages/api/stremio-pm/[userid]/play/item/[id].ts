import { getPremiumizeItemDetails } from '@/services/premiumize';
import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

// Play one file out of the user's own Premiumize cloud.
//
// Unlike a cast - which resolves a hash with `transfer/directdl` and stores
// nothing - a library entry already lives in the account, so the file id is the
// handle and `item/details` mints the link. It is minted per play rather than
// stored in the meta because Premiumize's CDN links expire on a schedule it does
// not document, while a client can hold a cached meta for far longer.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, id } = req.query;
	if (typeof userid !== 'string' || typeof id !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "id" query parameter',
		});
		return;
	}

	let profile: { apiKey: string } | null = null;
	try {
		profile = await db.getPremiumizeCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Premiumize profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Premiumize profile for user ${userid}` });
		return;
	}

	try {
		const details = await getPremiumizeItemDetails(profile.apiKey, id);
		// `stream_link` is the transcoded rendition and is only present for files
		// Premiumize decided to transcode; `link` is the original and always there.
		const url = details.stream_link || details.link;
		if (!url) {
			throw new Error('Premiumize returned no link for this file');
		}
		res.redirect(url);
	} catch (error) {
		console.error(
			'Failed to play Premiumize item:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to play link' });
	}
}
