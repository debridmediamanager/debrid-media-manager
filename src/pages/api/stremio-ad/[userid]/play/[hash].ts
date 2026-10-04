import { getAllDebridUser, getMagnetFiles, MagnetFile, unlockLink } from '@/services/allDebrid';
import { repository as db } from '@/services/repository';
import { parseSavedLinkMetaId } from '@/utils/allDebridCastCatalogHelper';
import {
	CastItemGoneError,
	CastPlayFailure,
	classifyAllDebridPlayError,
	settleWithin,
} from '@/utils/castAddonFailure';
import { sendPlayFailure } from '@/utils/castAddonResponses';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * How long a play may take before it answers "try again". The AllDebrid client
 * retries a throttled call for up to two minutes, and Nginx Proxy Manager cuts
 * the request at 60 s, after which an answer reaches nobody.
 */
const ALLDEBRID_PLAY_DEADLINE_MS = 25_000;

/** How long the premium check after a refused link may take. */
const PREMIUM_CHECK_MS = 5_000;

/** What AllDebrid said, for the log: its error code when it sent one. */
const describeAdError = (error: unknown) => {
	const { code, response } = (error ?? {}) as { code?: unknown; response?: { status?: unknown } };
	if (typeof response?.status === 'number') return `HTTP ${response.status}`;
	if (typeof code === 'string') return code;
	return error instanceof Error ? error.message : 'Unknown error';
};

interface FlatFile {
	path: string;
	size: number;
	link: string;
}

function flattenFiles(files: MagnetFile[], parentPath: string = ''): FlatFile[] {
	const result: FlatFile[] = [];

	for (const file of files) {
		const fullPath = parentPath ? `${parentPath}/${file.n}` : file.n;

		if (file.l) {
			result.push({
				path: fullPath,
				size: file.s || 0,
				link: file.l,
			});
		} else if (file.e) {
			result.push(...flattenFiles(file.e, fullPath));
		}
	}

	return result;
}

// Resolves the cast through the magnet the caster added.
//
// This only works for the caster themselves: a magnet id means nothing outside
// the account that created it, and it stops meaning anything to that account
// once the magnet is deleted. Kept as a fallback for rows saved before the
// `/f/` link was stored.
async function linkFromMagnet(
	apiKey: string,
	magnetId: number,
	fileIndex: number
): Promise<string> {
	const filesResult = await getMagnetFiles(apiKey, [magnetId]);
	const magnetFiles = filesResult.magnets?.[0];

	if (!magnetFiles) {
		throw new CastItemGoneError('Magnet not found');
	}

	if (magnetFiles.error) {
		// MAGNET_INVALID_ID for a magnet this account does not hold.
		throw Object.assign(new Error(magnetFiles.error.message), {
			code: magnetFiles.error.code,
		});
	}

	// Flatten files and filter for video files (same as catalog helper)
	const flatFiles = flattenFiles(magnetFiles.files || []);
	const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
	const videoFiles = flatFiles.filter((f) => {
		const filename = f.path.split('/').pop()?.toLowerCase() || '';
		return videoExtensions.some((ext) => filename.endsWith(ext));
	});

	// Sort videos by title (same order as catalog helper)
	videoFiles.sort((a, b) => {
		const aName = a.path.split('/').pop() || '';
		const bName = b.path.split('/').pop() || '';
		return aName.localeCompare(bName);
	});

	if (fileIndex < 0 || fileIndex >= videoFiles.length) {
		throw new CastItemGoneError(
			`File index ${fileIndex} out of range (0-${videoFiles.length - 1})`
		);
	}

	return videoFiles[fileIndex].link;
}

/**
 * Whether AllDebrid says the account has no premium. Only asked once a link
 * has been refused: a free key is refused every link with the same codes a
 * dead link draws, and the account is the thing the member can fix.
 */
async function lacksPremium(apiKey: string): Promise<boolean> {
	const check = await settleWithin(getAllDebridUser(apiKey), PREMIUM_CHECK_MS).catch(() => null);
	return !!check && !check.timedOut && check.value?.isPremium === false;
}

// Play an AllDebrid file from an existing magnet
// Format: magnetId:fileIndex (e.g., "123456:0")
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, hash } = req.query;
	if (typeof userid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "hash" query parameter',
		});
		return;
	}

	// Parse magnetId:fileIndex format
	const parts = hash.split(':');
	if (parts.length !== 2) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid format. Expected magnetId:fileIndex',
		});
		return;
	}

	// An `l`-prefixed id carries a saved hoster link rather than a magnet id.
	const savedLink = parseSavedLinkMetaId(parts[0]);
	const magnetId = parseInt(parts[0], 10);
	const fileIndex = parseInt(parts[1], 10);

	if ((!savedLink && isNaN(magnetId)) || isNaN(fileIndex)) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid magnetId or fileIndex',
		});
		return;
	}

	let profile: { apiKey: string } | null;
	try {
		profile = await db.getAllDebridCastProfile(userid);
	} catch (error) {
		return sendPlayFailure(res, 'ad', 'unavailable', describeAdError(error));
	}
	if (!profile) {
		return sendPlayFailure(res, 'ad', 'not-connected', 'no cast profile');
	}

	const apiKey = profile.apiKey;

	const resolveStreamUrl = async (): Promise<string> => {
		// A saved link is already the source; there is no magnet to fall back to.
		if (savedLink) return (await unlockLink(apiKey, savedLink)).link;

		// The stored `/f/` link first: any premium key can unlock it and it
		// outlives the magnet it came from, so it is the only form that works
		// for a stream cast by someone else - which is every "other" stream the
		// catalog offers. Resolving through the magnet id instead answers
		// MAGNET_INVALID_ID for anyone but the caster.
		const link = await db.getAllDebridCastLink(magnetId, fileIndex);
		if (!link) {
			return (await unlockLink(apiKey, await linkFromMagnet(apiKey, magnetId, fileIndex)))
				.link;
		}

		try {
			return (await unlockLink(apiKey, link)).link;
		} catch (unlockError) {
			// Only a refusal of the link itself is worth the magnet, which still
			// works when the caster is the viewer. A refused key or account, or
			// a provider having a bad minute, refuses the magnet just the same.
			if (classifyAllDebridPlayError(unlockError) !== 'gone') throw unlockError;
			console.log(
				'[AllDebrid Play] Stored link refused, trying the magnet:',
				describeAdError(unlockError)
			);
			try {
				const fresh = await linkFromMagnet(apiKey, magnetId, fileIndex);
				return (await unlockLink(apiKey, fresh)).link;
			} catch {
				// For anyone but the caster the magnet id means nothing, so its
				// refusal says nothing about the stream; the stored link's does.
				throw unlockError;
			}
		}
	};

	const play = async (): Promise<
		{ url: string } | { failure: CastPlayFailure; detail: string }
	> => {
		try {
			return { url: await resolveStreamUrl() };
		} catch (error) {
			let failure = classifyAllDebridPlayError(error);
			if (failure === 'gone' && (await lacksPremium(apiKey))) failure = 'account';
			return { failure, detail: describeAdError(error) };
		}
	};

	const outcome = await settleWithin(play(), ALLDEBRID_PLAY_DEADLINE_MS);
	if (outcome.timedOut) {
		return sendPlayFailure(
			res,
			'ad',
			'unavailable',
			`no answer within ${ALLDEBRID_PLAY_DEADLINE_MS / 1000}s`
		);
	}
	if ('failure' in outcome.value) {
		return sendPlayFailure(res, 'ad', outcome.value.failure, outcome.value.detail);
	}
	res.redirect(outcome.value.url);
}
