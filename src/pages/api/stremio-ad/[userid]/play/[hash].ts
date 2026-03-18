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
		// Get files with download links from the existing magnet
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

		const selectedFile = videoFiles[fileIndex];

		// Unlock the AllDebrid link to get the actual download URL
		const unlocked = await unlockLink(apiKey, selectedFile.link);
		const streamUrl = unlocked.link;

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
