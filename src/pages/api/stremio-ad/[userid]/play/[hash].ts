import { getMagnetFiles, MagnetFile, unlockLink } from '@/services/allDebrid';
import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

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
		throw new Error('Magnet not found');
	}

	if (magnetFiles.error) {
		throw new Error(magnetFiles.error.message);
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
		throw new Error(`File index ${fileIndex} out of range (0-${videoFiles.length - 1})`);
	}

	return videoFiles[fileIndex].link;
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

	const magnetId = parseInt(parts[0], 10);
	const fileIndex = parseInt(parts[1], 10);

	if (isNaN(magnetId) || isNaN(fileIndex)) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid magnetId or fileIndex',
		});
		return;
	}

	// Get user's AllDebrid profile with API key
	let profile: { apiKey: string } | null = null;
	try {
		profile = await db.getAllDebridCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get AllDebrid profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get AllDebrid profile for user ${userid}` });
		return;
	}

	const apiKey = profile.apiKey;

	try {
		// The stored `/f/` link first: any premium key can unlock it and it
		// outlives the magnet it came from, so it is the only form that works
		// for a stream cast by someone else - which is every "other" stream the
		// catalog offers. Resolving through the magnet id instead answers
		// MAGNET_INVALID_ID for anyone but the caster.
		let link = await db.getAllDebridCastLink(magnetId, fileIndex);
		if (!link) {
			link = await linkFromMagnet(apiKey, magnetId, fileIndex);
		}

		let streamUrl: string;
		try {
			streamUrl = (await unlockLink(apiKey, link)).link;
		} catch (unlockError) {
			// A stored link can rot (the content was removed upstream). Fall back
			// to the magnet, which still works when the caster is the viewer.
			console.log(
				'[AllDebrid Play] Stored link failed, trying the magnet:',
				unlockError instanceof Error ? unlockError.message : 'Unknown error'
			);
			const fresh = await linkFromMagnet(apiKey, magnetId, fileIndex);
			streamUrl = (await unlockLink(apiKey, fresh)).link;
		}

		// Redirect to the download URL
		res.redirect(streamUrl);
	} catch (error: any) {
		console.error(
			'Failed to play AllDebrid link:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to play link' });
	}
}
