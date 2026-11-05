import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	selectFiles,
	unrestrictLink,
} from '@/services/realDebrid';
import { BLOCKED_MESSAGE, isHashBlocked } from '@/services/takedown/blocklist';
import { classifyRdPlayError } from '@/utils/castAddonFailure';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { prisma } from '@/utils/prisma';
import { RdAddPausedError, retryRdAddThroughPause } from '@/utils/rdAddPause';
import { isDeadRdLink } from '@/utils/rdLinkRot';
import { isVideo } from '@/utils/selectable';
import { NextApiRequest, NextApiResponse } from 'next';

export interface UnrestrictRequest {
	link: string;
	hash: string;
	fileId: number;
	accessToken: string;
}

export interface UnrestrictTrackResponse {
	streamUrl: string;
	filename: string;
	filesize: number;
	mimeType: string;
}

const MIME_TYPES: Record<string, string> = {
	'.flac': 'audio/flac',
	'.mp3': 'audio/mpeg',
	'.m4a': 'audio/mp4',
	'.aac': 'audio/aac',
	'.ogg': 'audio/ogg',
	'.opus': 'audio/opus',
	'.wav': 'audio/wav',
	'.wma': 'audio/x-ms-wma',
};

function getMimeType(filename: string): string {
	const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
	return MIME_TYPES[ext] ?? 'audio/mpeg';
}

/**
 * RD does not have the album cached. Measured 2026-11-01 on a test account: an
 * uncached album added once sits at `downloading` 0%, and added two or three
 * times at once (the player's play and prefetch) every copy turns `error`.
 * Cached albums reach `downloaded` within a second either way.
 *
 * RD caches by the exact files selected: all 18 tracks of a cached album read
 * `downloaded`, any 17 or a single one `downloading`. So a status speaks for
 * the whole selection, never for one track, and the selection asked for must be
 * the music spider's: every .flac and .mp3 (scraps `rd_pipeline.py`).
 */
class NotCachedError extends Error {}
/** The album is cached but RD calls this one track's fresh link gone. */
class TrackGoneError extends Error {}
const NOT_CACHED_STATUSES = new Set(['error', 'dead', 'virus', 'magnet_error']);
const isSpiderAudio = (f: { path: string }) => /\.(flac|mp3)$/i.test(f.path);

const NOT_CACHED_MESSAGE =
	"Real-Debrid no longer has this album cached, so it can't be played. It has been taken out of the catalog.";
const TRACK_GONE_MESSAGE =
	"Real-Debrid no longer has this track, so it can't be played. The rest of the album still plays.";

/** What the listener reads when a track will not start: the status and the reason. */
function explainFailure(error: unknown): { status: number; error: string } {
	if (error instanceof NotCachedError) return { status: 410, error: NOT_CACHED_MESSAGE };
	if (error instanceof TrackGoneError) return { status: 410, error: TRACK_GONE_MESSAGE };
	if (error instanceof RdAddPausedError) return { status: 503, error: error.message };
	switch (classifyRdPlayError(error)) {
		case 'credential':
			return { status: 401, error: 'Your Real-Debrid login has expired. Log in again.' };
		case 'account':
			return {
				status: 403,
				error: 'Real-Debrid refused your account. Check that your premium is active.',
			};
		case 'network':
			return {
				status: 403,
				error: "Real-Debrid won't make links for your network. If you use a VPN or proxy, try without it.",
			};
		case 'refused':
			return { status: 451, error: "Real-Debrid won't serve this album." };
	}
	if ((error as any)?.response?.status === 429) {
		return {
			status: 429,
			error: 'Real-Debrid is limiting your account right now. Wait a minute and try again.',
		};
	}
	return {
		status: 502,
		error: "Real-Debrid couldn't start this track right now. Try again in a while.",
	};
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the torrent to have files available (magnet conversion complete).
 * Polls getTorrentInfo until files appear or timeout is reached.
 */
async function waitForFiles(
	accessToken: string,
	torrentId: string,
	maxAttempts = 10,
	intervalMs = 1000
): Promise<Awaited<ReturnType<typeof getTorrentInfo>>> {
	for (let i = 0; i < maxAttempts; i++) {
		const info = await getTorrentInfo(accessToken, torrentId, false);
		if (info.files.length > 0) return info;
		await delay(intervalMs);
	}
	throw new Error('Timed out waiting for torrent files');
}

/**
 * Wait for the torrent to reach "downloaded" status (links available).
 * Polls getTorrentInfo until status is downloaded or timeout is reached.
 */
async function waitForDownloaded(
	accessToken: string,
	torrentId: string,
	maxAttempts = 15,
	intervalMs = 1000
): Promise<Awaited<ReturnType<typeof getTorrentInfo>>> {
	let status = '';
	for (let i = 0; i < maxAttempts; i++) {
		const info = await getTorrentInfo(accessToken, torrentId, false);
		status = info.status;
		if (status === 'downloaded' && info.links.length > 0) return info;
		if (NOT_CACHED_STATUSES.has(status)) throw new NotCachedError(`Torrent status: ${status}`);
		await delay(intervalMs);
	}
	// Still downloading after the wait: RD is fetching it from peers, not serving a cached copy.
	if (status === 'downloading') throw new NotCachedError('Torrent status: downloading');
	throw new Error(`Timed out waiting for torrent to be ready (${status})`);
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<
		UnrestrictTrackResponse | { error: string; errorCode?: number; dead?: boolean }
	>
) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { link, hash, fileId, accessToken } = req.body as UnrestrictRequest;

	if (!accessToken) {
		return res.status(401).json({ error: 'Missing access token' });
	}

	if (!hash || fileId === undefined) {
		return res.status(400).json({ error: 'Missing hash or fileId' });
	}
	if (await isHashBlocked(hash)) {
		return res.status(451).json({ error: BLOCKED_MESSAGE });
	}

	const ipAddress = getClientIpFromRequest(req);

	let storedLinkDead = false;
	// Fast path: try to unrestrict the stored link directly (avoids full magnet flow)
	if (link) {
		try {
			const unrestricted = await unrestrictLink(accessToken, link, ipAddress, false);
			console.log('[Music Unrestrict] Fast path succeeded', { hash, fileId });
			return res.status(200).json({
				streamUrl: unrestricted.download,
				filename: unrestricted.filename,
				filesize: unrestricted.filesize,
				mimeType: getMimeType(unrestricted.filename),
			});
		} catch (fastPathError: unknown) {
			storedLinkDead = isDeadRdLink(fastPathError);
			console.log('[Music Unrestrict] Fast path failed, falling back to magnet flow', {
				hash,
				fileId,
				error:
					(fastPathError as any)?.response?.data?.error ||
					(fastPathError as Error)?.message,
			});
		}
	}

	let torrentId: string | undefined;

	try {
		// The player is waiting: a 451 gets one more try after the account's
		// pause, then a temporary 503 rather than a verdict on the release.
		// Unless the album's name on record is one RD blocks, which no wait changes.
		const onRecord = await prisma.availableMusic
			.findUnique({ where: { hash }, select: { filename: true, originalFilename: true } })
			.catch(() => null);
		const names = onRecord ? [onRecord.originalFilename, onRecord.filename] : [];
		torrentId = await retryRdAddThroughPause(
			() => addHashAsMagnet(accessToken, hash, false, { names }),
			{ token: accessToken }
		);

		// Wait for magnet conversion to complete (files become available)
		const initialInfo = await waitForFiles(accessToken, torrentId);

		// The spider's selection, the one RD has cached; then media files, then everything.
		const { files } = initialInfo;
		const spider = files.filter(isSpiderAudio);
		const media = files.filter(isVideo);
		const chosen = spider.length ? spider : media.length ? media : files;
		await selectFiles(
			accessToken,
			torrentId,
			chosen.map((f) => `${f.id}`),
			false
		);

		// Wait for torrent to reach "downloaded" status so links are populated
		const torrentInfo = await waitForDownloaded(accessToken, torrentId);

		const selected = torrentInfo.files.filter((f) => f.selected);
		// A mixed selection can be a single RAR bundle, not per-track links.
		if (selected.length !== torrentInfo.links.length) {
			throw new Error(
				`link count mismatch: ${selected.length} selected files, ${torrentInfo.links.length} links`
			);
		}
		const fileIdx = selected.findIndex((f) => f.id === fileId);
		const link = fileIdx < 0 ? undefined : torrentInfo.links[fileIdx];

		if (!link) {
			throw new Error('No download link found for this track');
		}

		let unrestricted;
		try {
			unrestricted = await unrestrictLink(accessToken, link, ipAddress, false);
		} catch (error) {
			// A link minted a moment ago that RD calls gone: this track is,
			// not the album, which RD just served whole.
			throw isDeadRdLink(error) && fileIdx >= 0 ? new TrackGoneError(link) : error;
		}

		await deleteTorrent(accessToken, torrentId, false);

		// Held /d/ keys do not expire with age, but some still fail while RD
		// reports the torrent downloaded. Keep working replacement links for
		// the next play; only one-per-file selections can be paired in order.
		if (storedLinkDead) {
			await Promise.all(
				selected.map((f, i) =>
					prisma.availableMusicFile.updateMany({
						where: { hash, file_id: f.id },
						data: { link: torrentInfo.links[i] },
					})
				)
			).catch((e) => console.error('[Music Unrestrict] Link refresh failed', hash, e));
		}

		console.log('[Music Unrestrict] Magnet flow succeeded', { hash, fileId });

		return res.status(200).json({
			streamUrl: unrestricted.download,
			filename: unrestricted.filename,
			filesize: unrestricted.filesize,
			mimeType: getMimeType(unrestricted.filename),
		});
	} catch (error: unknown) {
		if (error instanceof RdAddPausedError) res.setHeader('Retry-After', '120');
		if (torrentId) {
			try {
				await deleteTorrent(accessToken, torrentId, false);
			} catch {
				// ignore cleanup errors
			}
		}

		const axiosError = (error as any)?.response?.data;
		const errorCode = axiosError?.error_code;
		const errorMessage =
			axiosError?.error || (error as Error)?.message || 'Failed to unrestrict link';

		console.error('[Music Unrestrict] Error:', {
			hash,
			fileId,
			errorCode,
			errorMessage,
			status: (error as any)?.response?.status,
		});

		// Gone for everyone: likes and playlists show it unavailable. An album
		// goes with its last track, and the music spider checks it again when a
		// crawl finds it.
		const dead = error instanceof NotCachedError || error instanceof TrackGoneError;
		if (dead) {
			try {
				if (error instanceof TrackGoneError) {
					await prisma.availableMusicFile.deleteMany({
						where: { hash, file_id: fileId },
					});
				}
				const left =
					error instanceof TrackGoneError
						? await prisma.availableMusicFile.count({ where: { hash } })
						: 0;
				if (left === 0) await prisma.availableMusic.deleteMany({ where: { hash } });
				console.log('[Music Unrestrict] Dropped dead', { hash, fileId, albumLeft: left });
			} catch (e) {
				console.error('[Music Unrestrict] Failed to drop dead music', hash, e);
			}
		}
		const failure = explainFailure(error);
		return res
			.status(failure.status)
			.json({ error: failure.error, errorCode, ...(dead && { dead }) });
	}
}
