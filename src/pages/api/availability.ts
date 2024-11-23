import { NextApiRequest, NextApiResponse } from 'next';
import { PlanetScaleCache } from '../../services/planetscale';

function isValidTorrentHash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/.test(hash);
}

function isValidImdbId(imdbId: string): boolean {
	return /^tt\d+$/.test(imdbId);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const {
			filename,
			original_filename,
			hash,
			bytes,
			original_bytes,
			host,
			progress,
			status,
			files,
			links,
			ended,
			imdbId,
		} = req.body;

		// Validate required fields and conditions
		if (!hash || !filename || !imdbId) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// Validate IMDb ID format
		if (!isValidImdbId(imdbId)) {
			return res.status(400).json({ error: 'Invalid IMDb ID format' });
		}

		// Validate host
		if (host !== 'real-debrid.com') {
			return res.status(400).json({ error: 'Invalid host. Only real-debrid.com is allowed' });
		}

		// Validate status
		if (status !== 'downloaded') {
			return res.status(400).json({ error: 'Invalid status. Must be "downloaded"' });
		}

		// Validate progress
		if (progress !== 100) {
			return res.status(400).json({ error: 'Invalid progress. Must be 100' });
		}

		// Validate hash format
		if (!isValidTorrentHash(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}

		// Validate bytes
		if (!bytes || bytes <= 0 || !original_bytes || original_bytes <= 0) {
			return res.status(400).json({ error: 'Bytes must be greater than 0' });
		}

		// Validate files and links
		if (!Array.isArray(files) || !Array.isArray(links)) {
			return res.status(400).json({ error: 'Files and links must be arrays' });
		}

		// Get selected files
		const selectedFiles = files.filter((file) => file.selected === 1);

		// Validate link distribution
		if (selectedFiles.length === 0 || selectedFiles.length !== links.length) {
			return res
				.status(400)
				.json({ error: 'Number of selected files must match number of links' });
		}

		const db = new PlanetScaleCache();

		// Create available record with only selected files
		await db.prisma.available.create({
			data: {
				hash,
				imdbId,
				filename,
				originalFilename: original_filename,
				bytes: BigInt(bytes),
				originalBytes: BigInt(original_bytes),
				host,
				progress,
				status,
				ended: new Date(ended),
				files: {
					create: selectedFiles.map((file, index) => ({
						link: links[index],
						file_id: file.id,
						path: file.path,
						bytes: BigInt(file.bytes),
					})),
				},
			},
		});

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error saving available torrent:', error);
		return res.status(500).json({ error: 'Failed to save available torrent' });
	}
}
