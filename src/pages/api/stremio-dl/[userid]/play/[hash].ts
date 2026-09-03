import { repository as db } from '@/services/repository';
import {
	describeDebridLinkError,
	resolveDebridLinkRelease,
} from '@/utils/debridLinkCastApiHelpers';
import { matchDebridLinkFile } from '@/utils/debridLinkCastFiles';
import { NextApiRequest, NextApiResponse } from 'next';

// Play a Debrid-Link cast.
//
// The resolve is `POST /seedbox/add` with the full magnet, run with the
// *viewer's* credential. That one call is the whole path: a cached release
// answers synchronously complete (`status: 100`) with a live download URL per
// file, in about 150 ms, so hash to playable link is one request.
//
// **Nothing is removed afterwards, on purpose.** Three measured facts make a
// cleanup here actively dangerous rather than merely unnecessary:
//
//  - The add is **idempotent by hash and the torrent id is stable**. An add on
//    a release the viewer already had returns *their* torrent id, and is
//    indistinguishable from one this route created.
//  - **Remove never fails.** `DELETE /seedbox/<anything>/remove` answers
//    `{"success":true,"value":["<anything>"]}` - the echoed array is what the
//    server *tried*, not what existed. So a wrong delete has no error signal at
//    all; it would silently take a seedbox item the viewer put there on purpose.
//  - There is **nothing to clean up**. The links survive removal, the id is
//    stable across remove and re-add, and the seedbox holds a reference rather
//    than a per-viewer copy.
//
// Offcloud's play route does remove, and correctly - it probes the account
// first and refuses to claim ownership it could not verify. Debrid-Link offers
// no such probe that is cheaper than the add itself, and the upside is nil, so
// the whole question is dropped instead of answered badly.
//
// When the viewer's own credential cannot resolve the hash - daily 50-torrent
// quota spent, an hour-long `floodDetected` lockout, a dead token - the stored
// `downloadUrl` is served instead. A Debrid-Link URL is keyless, IP-agnostic
// and survives deletion, so it works for anyone; that is exactly why it is also
// an irrevocable capability, and why it is never logged and never returned in
// any listing.
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

	const wantedPath = typeof file === 'string' && file ? file : undefined;

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

	/**
	 * The stored keyless URL, when there is one. Never logged - the value is a
	 * permanent unauthenticated capability to the content.
	 */
	const storedFallback = async (): Promise<string | null> => {
		try {
			return await db.getDebridLinkStoredDownloadUrl(hash, wantedPath);
		} catch (error) {
			console.error(
				'Debrid-Link stored-link lookup failed:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			return null;
		}
	};

	try {
		const release = await resolveDebridLinkRelease(profile.apiKey, hash);

		if (!release.finished) {
			// No cheap wait exists. `seedbox/activity` is another request against
			// an endpoint whose punishment for a loop is an hour, and the add
			// response already carries the percent - so this reports and stops.
			const stored = await storedFallback();
			if (stored) {
				res.redirect(stored);
				return;
			}
			res.status(504).json({
				error: `Still downloading on Debrid-Link (${release.percent}%) - try again once it finishes`,
			});
			return;
		}

		const wanted = matchDebridLinkFile(release.files, wantedPath);
		if (!wanted?.link) {
			const stored = await storedFallback();
			if (stored) {
				res.redirect(stored);
				return;
			}
			throw new Error(
				release.files.length === 0
					? 'No video files in this release on Debrid-Link'
					: `File "${wantedPath ?? ''}" is not in this release`
			);
		}

		// The redirect target is never logged: it is a permanent capability.
		res.redirect(wanted.link);
	} catch (error) {
		const message = describeDebridLinkError(error);

		const stored = await storedFallback();
		if (stored && !res.writableEnded) {
			console.error('Debrid-Link play fell back to the stored link:', message);
			res.redirect(stored);
			return;
		}

		console.error('Failed to play Debrid-Link link:', message);
		if (!res.writableEnded) {
			res.status(500).json({ error: message });
		}
	}
}
