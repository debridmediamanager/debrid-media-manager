import { repository as db } from '@/services/repository';
import {
	describeDebridLinkError,
	resolveDebridLinkTorrentById,
} from '@/utils/debridLinkCastApiHelpers';
import { matchDebridLinkFile } from '@/utils/debridLinkCastFiles';
import { NextApiRequest, NextApiResponse } from 'next';

// Play one file out of the user's own Debrid-Link seedbox.
//
// A library entry already lives in the account, so its torrent id is the handle
// and nothing is added here - which also means this route spends no quota at
// all, unlike the hash-addressed one.
//
// The URL is resolved per play rather than stored in the meta because a
// Debrid-Link download URL is a keyless capability that keeps serving after the
// torrent is deleted, and a client can hold a cached meta indefinitely. Writing
// one into a meta would hand a permanent unauthenticated link to whatever
// caches it.
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
		profile = await db.getDebridLinkCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Debrid-Link profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Debrid-Link profile for user ${userid}` });
		return;
	}

	try {
		// One request: the filtered listing carries the file list with a live URL
		// per file, and it is what expands a torrent that lists as a single ZIP.
		const resolved = await resolveDebridLinkTorrentById(profile.apiKey, id);
		if (!resolved) {
			throw new Error('Debrid-Link has no such torrent for this account');
		}
		if (resolved.files.length === 0) {
			throw new Error('Debrid-Link returned no video files for this item');
		}

		const wanted = matchDebridLinkFile(
			resolved.files,
			typeof file === 'string' ? file : undefined
		);
		if (!wanted?.link) {
			throw new Error(`File "${file}" is not in this item`);
		}

		res.redirect(wanted.link);
	} catch (error) {
		const message = describeDebridLinkError(error);
		console.error('Failed to play Debrid-Link item:', message);
		res.status(500).json({ error: message });
	}
}
