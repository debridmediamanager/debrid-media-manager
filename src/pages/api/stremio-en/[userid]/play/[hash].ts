import {
	EasynewsAuthError,
	EasynewsGoneError,
	isEasynewsPath,
	resolveEasynewsLink,
} from '@/services/easynews';
import { repository as db } from '@/services/repository';
import { sendPlayFailure } from '@/utils/castAddonResponses';
import { easynewsCredentialsOf } from '@/utils/easynewsCastKey';
import { NextApiRequest, NextApiResponse } from 'next';

// Play an Easynews file. There is no stored link: Easynews signs a new one per
// request, and that link needs no login, so it is minted here with the stream
// list owner's account and the player is sent to it. The file path rides in the
// URL because a search result has no cast row to look up.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, hash, path } = req.query;
	if (
		typeof userid !== 'string' ||
		typeof hash !== 'string' ||
		!isEasynewsPath(path) ||
		!path.startsWith(`${hash}.`)
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid", "hash" or "path" query parameter',
		});
		return;
	}

	let apiKey: string;
	try {
		const profile = await db.getEasynewsCastProfile(userid);
		if (!profile) return sendPlayFailure(res, 'en', 'not-connected', `no profile ${userid}`);
		apiKey = profile.apiKey;
	} catch (error) {
		return sendPlayFailure(
			res,
			'en',
			'unavailable',
			error instanceof Error ? error.message : 'profile read failed'
		);
	}
	const credentials = easynewsCredentialsOf(apiKey);
	if (!credentials) return sendPlayFailure(res, 'en', 'credential', 'stored key unreadable');

	try {
		res.redirect(await resolveEasynewsLink(credentials, path));
	} catch (error) {
		const detail = error instanceof Error ? error.message : 'Unknown error';
		if (error instanceof EasynewsAuthError) {
			return sendPlayFailure(res, 'en', 'credential', detail);
		}
		if (error instanceof EasynewsGoneError) {
			return sendPlayFailure(res, 'en', 'gone', detail);
		}
		return sendPlayFailure(res, 'en', 'unavailable', detail);
	}
}
