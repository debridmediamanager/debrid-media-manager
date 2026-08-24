import { directDownloadPremiumize } from '@/services/premiumize';
import { repository as db } from '@/services/repository';
import {
	matchPremiumizeFile,
	premiumizePlaybackUrl,
	premiumizeVideoFiles,
} from '@/utils/premiumizeCastFiles';
import { NextApiRequest, NextApiResponse } from 'next';

// Play a Premiumize cast.
//
// There is no stored link to redeem. `transfer/directdl` resolves the hash to
// signed CDN links in one stateless call - nothing lands in the account - so the
// link is minted here, fresh, with the *viewer's* key. That is what makes a cast
// playable by someone other than the caster, and it is also what keeps the
// bandwidth on the right account: Premiumize bills the minting customer.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, hash, file } = req.query;
	if (typeof userid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "hash" query parameter',
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
		const files = premiumizeVideoFiles(await directDownloadPremiumize(profile.apiKey, hash));
		if (files.length === 0) {
			throw new Error('No video files in this release on Premiumize');
		}

		const wanted = matchPremiumizeFile(files, typeof file === 'string' ? file : undefined);
		if (!wanted) {
			throw new Error(`File "${file}" is not in this release`);
		}

		res.redirect(premiumizePlaybackUrl(wanted));
	} catch (error) {
		console.error(
			'Failed to play Premiumize link:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to play link' });
	}
}
