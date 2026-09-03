import { exploreOffcloudCloud, joinExploreWithCacheInfo } from '@/services/offcloud';
import { repository as db } from '@/services/repository';
import { matchOffcloudFile, offcloudVideoFiles } from '@/utils/offcloudCastFiles';
import { NextApiRequest, NextApiResponse } from 'next';

// Play one file out of the user's own Offcloud cloud.
//
// Unlike a cast - which resolves a hash and cleans up after itself - a library
// entry already lives in the account, so its `requestId` is the handle and
// nothing is added or removed here. The link is minted per play rather than
// stored in the meta because an Offcloud CDN URL is signed with a mint
// timestamp, while a client can hold a cached meta for far longer - and
// because the URL carries the account's own token, which must not be written
// into anything a client stores.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, id, file } = req.query;
	if (typeof userid !== 'string' || typeof id !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "id" query parameter',
		});
		return;
	}

	let profile: { apiKey: string } | null = null;
	try {
		profile = await db.getOffcloudCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Offcloud profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Offcloud profile for user ${userid}` });
		return;
	}

	try {
		// `cloud/explore` is a bare array of signed URLs - no names, no ids - so
		// the file is matched on the basename in the CDN path.
		const links = await exploreOffcloudCloud(profile.apiKey, id);
		const files = offcloudVideoFiles(joinExploreWithCacheInfo(links, []));
		if (files.length === 0) {
			throw new Error('Offcloud returned no video files for this item');
		}

		const wanted = matchOffcloudFile(files, typeof file === 'string' ? file : undefined);
		if (!wanted || !wanted.link) {
			throw new Error(`File "${file}" is not in this item`);
		}

		res.redirect(wanted.link);
	} catch (error) {
		console.error(
			'Failed to play Offcloud item:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to play link' });
	}
}
