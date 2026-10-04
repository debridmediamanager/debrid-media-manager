import { repository as db } from '@/services/repository';
import { requestDownloadLink, requestUsenetLink, requestWebDownloadLink } from '@/services/torbox';
import {
	classifyTorBoxPlayError,
	providerErrorDetail,
	settleWithin,
} from '@/utils/castAddonFailure';
import { sendPlayFailure } from '@/utils/castAddonResponses';
import {
	getBiggestFileTorBoxStreamUrl,
	getFileByNameTorBoxStreamUrl,
	getWebDownloadStreamUrlByHash,
} from '@/utils/getTorBoxStreamUrl';
import { isWebDownloadHash, parseTorBoxCastTarget } from '@/utils/torboxWebDownload';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * How long a play may take before it answers "try again". Nginx Proxy Manager
 * cuts the request at 60 s - 108 TorBox plays ran into that in the week to
 * 2026-10-03 - and an answer after that reaches nobody. Resolving a cached
 * release takes a few seconds; this leaves room for a slow add.
 */
const TORBOX_PLAY_DEADLINE_MS = 25_000;

/** What TorBox said, for the log: `403 PLAN_RESTRICTED_FEATURE`. */
const describeTorBoxError = (error: unknown) => {
	const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
	const { error: tbError } = providerErrorDetail(error);
	const message = error instanceof Error ? error.message : 'Unknown error';
	return typeof status === 'number' ? `${status} ${tbError ?? message}` : message;
};

// Play a TorBox file from an existing torrent
// Supports two formats:
// 1. torrentId:fileId (e.g., "123456:789") - direct lookup (with ?h=hash&file=filename fallback)
//    A `w` prefix on the id (e.g., "w1599037:0") means a web download and a `u`
//    prefix a usenet download; each lives in a different TorBox table whose ids
//    overlap torrent ids. Library metas carry the prefix; casts have none and
//    identify a web download by its md5 hash instead.
// 2. hash (e.g., "fbadffe5476df0674dbec75e81426895e40b6427") - legacy format
//    - With ?file=filename: matches specific file by name (for TV episodes)
//    - Without ?file: uses biggest file (for movies)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, hash, file, h: fallbackHash, own } = req.query;
	if (typeof userid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "hash" query parameter',
		});
		return;
	}

	// Get user's TorBox profile with API key
	let profile: { apiKey: string } | null;
	try {
		profile = await db.getTorBoxCastProfile(userid);
	} catch (error) {
		return sendPlayFailure(res, 'tb', 'unavailable', describeTorBoxError(error));
	}
	if (!profile) {
		return sendPlayFailure(res, 'tb', 'not-connected', 'no cast profile');
	}

	const apiKey = profile.apiKey;
	const filename = typeof file === 'string' ? file : undefined;

	// TorBox hashes web downloads with md5 and torrents with sha1, which is what
	// tells the two apart here: a web download resolves through the webdl
	// endpoints, and can only be served from the account that created it.
	const isWebDownload = isWebDownloadHash(
		typeof fallbackHash === 'string' && fallbackHash ? fallbackHash : hash
	);

	let target: ReturnType<typeof parseTorBoxCastTarget> = null;
	let fileId = NaN;
	if (hash.includes(':')) {
		const parts = hash.split(':');
		if (parts.length !== 2) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Invalid format. Expected torrentId:fileId',
			});
			return;
		}
		target = parseTorBoxCastTarget(parts[0]);
		fileId = parseInt(parts[1], 10);
		if (!target || isNaN(fileId)) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Invalid torrentId or fileId',
			});
			return;
		}
	}

	const resolveStreamUrl = async (): Promise<string> => {
		if (target) {
			const torrentId = target.id;
			// The id itself settles it for a library entry; a cast has no prefix and
			// is identified by its hash instead.
			const resolveAsWebDownload = target.isWebDownload || isWebDownload;
			const resolveAsUsenet = target.kind === 'usenet';

			// A torrent id only resolves inside the account that created it, so for
			// someone else's cast the direct lookup is a guaranteed 500 - measured
			// 2026-08-24, three of three foreign ids answered DATABASE_ERROR. The
			// stream route marks the caster's own rows with `own=1`; without it,
			// skip straight to the hash rather than spend the round trip.
			//
			// Retries stay off even for an owned row: a 500 there (the torrent was
			// deleted) should reach the hash fallback now, not after ~2 min of
			// exponential backoff.
			// A web download is always the caster's own - the stream route drops
			// other users' web downloads because no other key can resolve them.
			const canResolveDirectly =
				own === '1' ||
				resolveAsWebDownload ||
				resolveAsUsenet ||
				typeof fallbackHash !== 'string';
			let streamUrl: string | undefined;
			let directError: unknown;
			try {
				if (!canResolveDirectly) {
					throw new Error("not this account's torrent id");
				}
				const downloadResult = resolveAsUsenet
					? await requestUsenetLink(
							apiKey,
							{ usenet_id: torrentId, file_id: fileId },
							{ timeout: 8000 }
						)
					: resolveAsWebDownload
						? await requestWebDownloadLink(
								apiKey,
								{ web_id: torrentId, file_id: fileId },
								{ skipRetry: true, timeout: 8000 }
							)
						: await requestDownloadLink(
								apiKey,
								{ torrent_id: torrentId, file_id: fileId },
								{ skipRetry: true, timeout: 8000 }
							);

				if (downloadResult.success && downloadResult.data) {
					streamUrl = downloadResult.data;
				}
			} catch (error) {
				// The fallback spends the same key on a cache check and an add, so
				// a key TorBox has just refused goes no further.
				const failure = classifyTorBoxPlayError(error);
				if (failure === 'credential' || failure === 'account') throw error;
				directError = error;
				console.log(
					'[TorBox Play] Direct lookup failed, trying hash fallback:',
					error instanceof Error ? error.message : 'Unknown error'
				);
			}

			// If direct lookup failed and we have a fallback hash, use it.
			//
			// Reaching here means the torrent is not this viewer's, so resolving
			// it has to add it to their account first. `releaseIfAdded` hands it
			// straight back: they never asked for it, and the minted link keeps
			// working without it - an in-flight read survives the delete and a
			// later seek still answers 206.
			if (!streamUrl && typeof fallbackHash === 'string') {
				if (resolveAsWebDownload) {
					streamUrl = await getWebDownloadStreamUrlByHash(apiKey, fallbackHash, filename);
				} else if (filename) {
					const [url] = await getFileByNameTorBoxStreamUrl(
						apiKey,
						fallbackHash,
						filename,
						{
							releaseIfAdded: true,
						}
					);
					streamUrl = url;
				} else {
					const [url] = await getBiggestFileTorBoxStreamUrl(apiKey, fallbackHash, {
						releaseIfAdded: true,
					});
					streamUrl = url;
				}
			}

			if (!streamUrl) {
				if (directError && typeof fallbackHash !== 'string') throw directError;
				throw new Error('Failed to get download link');
			}
			return streamUrl;
		}

		if (isWebDownload) {
			// Legacy format: web download hash
			const streamUrl = await getWebDownloadStreamUrlByHash(apiKey, hash, filename);
			if (!streamUrl) {
				throw new Error('Failed to get stream URL for web download');
			}
			return streamUrl;
		}

		// Legacy format: torrent hash. Same reasoning as the fallback above -
		// this is a play, so anything added to serve it is handed back.
		if (filename) {
			// Match by filename (for TV episodes from season packs)
			const [url] = await getFileByNameTorBoxStreamUrl(apiKey, hash, filename, {
				releaseIfAdded: true,
			});
			if (!url) {
				throw new Error(`Failed to find file "${filename}" in torrent`);
			}
			return url;
		}
		// No filename provided - use biggest file (for movies)
		const [url] = await getBiggestFileTorBoxStreamUrl(apiKey, hash, {
			releaseIfAdded: true,
		});
		if (!url) {
			throw new Error('Failed to get stream URL for torrent');
		}
		return url;
	};

	try {
		const outcome = await settleWithin(resolveStreamUrl(), TORBOX_PLAY_DEADLINE_MS);
		if (outcome.timedOut) {
			return sendPlayFailure(
				res,
				'tb',
				'unavailable',
				`no answer within ${TORBOX_PLAY_DEADLINE_MS / 1000}s`
			);
		}
		// Redirect to the download URL
		res.redirect(outcome.value);
	} catch (error) {
		return sendPlayFailure(
			res,
			'tb',
			classifyTorBoxPlayError(error),
			describeTorBoxError(error)
		);
	}
}
