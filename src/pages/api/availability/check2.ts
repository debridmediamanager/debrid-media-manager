import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

function isValidTorrentHash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/.test(hash);
}

// fetch availability with hashes, no IMDb ID constraint
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { hashes } = req.body;

		// Validate hashes array
		if (!Array.isArray(hashes)) {
			return res.status(400).json({ error: 'Hashes must be an array' });
		}

		if (hashes.length === 0) {
			return res.status(200).json({ available: [] });
		}

		if (hashes.length > 100) {
			return res.status(400).json({ error: 'Maximum 100 hashes allowed' });
		}

		// Validate each hash
		const invalidHash = hashes.find((hash) => !isValidTorrentHash(hash));
		if (invalidHash) {
			return res.status(400).json({
				error: 'Invalid hash format',
				hash: invalidHash,
			});
		}

		const db = new PlanetScaleCache();

		// Look up hashes without IMDb ID constraint
		const availableHashes = await db.prisma.available.findMany({
			where: {
				hash: { in: hashes },
			},
			select: {
				hash: true,
				files: {
					select: {
						path: true,
						bytes: true,
					},
				},
			},
		});

		return res.status(200).json({
			available: availableHashes.map((record) => ({
				hash: record.hash,
				files: record.files,
			})),
		});
	} catch (error) {
		console.error('Error checking available hashes:', error);
		return res.status(500).json({ error: 'Failed to check available hashes' });
	}
}
