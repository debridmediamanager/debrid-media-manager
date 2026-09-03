import {
	addOffcloudCloud,
	exploreOffcloudCloud,
	extractBtih,
	getOffcloudCacheInfo,
	getOffcloudCloudStatus,
	getOffcloudHistory,
	joinExploreWithCacheInfo,
	removeOffcloudCloud,
	type OffcloudStatus,
} from '@/services/offcloud';
import { repository as db } from '@/services/repository';
import { matchOffcloudFile, offcloudVideoFiles } from '@/utils/offcloudCastFiles';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * How long to wait for an item Offcloud has not already finished.
 *
 * A cached magnet answers `downloaded` in the add response itself, so this
 * budget is only ever spent on a cache miss or on a zombie - and a Stremio
 * client is sitting on this request, so it has to stay short enough to fail
 * rather than hang.
 */
const POLL_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 1_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether this account already holds the hash, and whether we could tell.
 *
 * `POST /api/cloud` is idempotent while an item lives - re-submitting a magnet
 * returns the same `requestId` - which means an add on a hash the viewer
 * already has in their cloud is indistinguishable from one that created it.
 * Removing afterwards would then delete a library item the viewer put there on
 * purpose. So the cloud is read first, and a failed read reports `known: false`
 * rather than a wrong `false`: not knowing must never license a delete.
 */
async function findExistingItem(apiKey: string, hash: string) {
	try {
		const history = await getOffcloudHistory(apiKey);
		const wanted = hash.toLowerCase();
		const found = history.find(
			(item) => extractBtih(item.originalLink ?? '') === wanted && !!item.requestId
		);
		return { found: found ?? null, known: true };
	} catch (error) {
		console.error(
			'Offcloud history probe failed; not adding a removal to it:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return { found: null, known: false };
	}
}

// Play an Offcloud cast.
//
// There is no stored link to redeem, and deliberately so: an Offcloud CDN URL
// carries an account-scoped token in its path, so a stored one would be the
// caster's credential handed to every viewer. The link is minted here instead,
// fresh, with the *viewer's* key - `POST /api/cloud` on a cached hash answers
// `downloaded` synchronously, so the whole resolve is add -> explore.
//
// Anything this route created for itself is removed again afterwards, so a
// viewer's cloud does not silently fill with items they never asked for.
// Removal was measured not to break the links it already minted, so the
// redirect goes out first and the cleanup is fire-and-forget behind it.
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

	const apiKey = profile.apiKey;
	let requestId = '';
	let ours = false;

	try {
		const { found, known } = await findExistingItem(apiKey, hash);
		let status: OffcloudStatus;

		if (found) {
			requestId = found.requestId;
			status = found.status;
		} else {
			const added = await addOffcloudCloud(apiKey, hash);
			if (!added.requestId) {
				throw new Error('Offcloud accepted the magnet without a request id');
			}
			requestId = added.requestId;
			status = added.status;
			// Only claim ownership when the probe actually said the item was not
			// there before.
			ours = known;
		}

		const deadline = Date.now() + POLL_TIMEOUT_MS;
		while (status !== 'downloaded' && Date.now() < deadline) {
			if (status === 'error' || status === 'canceled') break;
			await sleep(POLL_INTERVAL_MS);
			status = (await getOffcloudCloudStatus(apiKey, requestId)).status;
		}

		if (status !== 'downloaded') {
			// `created` with nothing behind it is Offcloud's zombie state - it
			// accepts an unusable magnet with a 200 and never finishes or fails
			// it. Ours to clean up. A `downloading` item is a real transfer that
			// will finish on its own, so it is left alone and picked up by the
			// history probe on the next attempt.
			ours = ours && status === 'created';
			res.status(504).json({
				error: `Offcloud is still '${status}' for this release - try again once it finishes`,
			});
			return;
		}

		const [links, info] = await Promise.all([
			exploreOffcloudCloud(apiKey, requestId),
			// Names, folders and sizes. Best effort: without it the join still
			// yields the decoded basenames out of the CDN paths, which is all the
			// file match needs.
			getOffcloudCacheInfo(apiKey, [hash]).catch(() => []),
		]);
		const files = offcloudVideoFiles(joinExploreWithCacheInfo(links, info[0]?.files ?? []));
		if (files.length === 0) {
			throw new Error('No video files in this release on Offcloud');
		}

		const wanted = matchOffcloudFile(files, typeof file === 'string' ? file : undefined);
		if (!wanted || !wanted.link) {
			throw new Error(`File "${file}" is not in this release`);
		}

		// The redirect target is never logged: its path carries the account token.
		res.redirect(wanted.link);
	} catch (error) {
		console.error(
			'Failed to play Offcloud link:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		if (!res.writableEnded) {
			res.status(500).json({ error: 'Failed to play link' });
		}
	} finally {
		// Behind the redirect, so playback never waits on it - and the links keep
		// serving after removal, so nothing it does can interrupt a stream.
		if (ours && requestId) {
			void removeOffcloudCloud(apiKey, requestId).catch((error) => {
				console.error(
					'Failed to clean up the Offcloud item this play created:',
					error instanceof Error ? error.message : 'Unknown error'
				);
			});
		}
	}
}
