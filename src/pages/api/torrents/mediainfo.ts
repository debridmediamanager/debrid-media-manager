import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { publicMediaInfo } from '@/utils/torrentSnapshot';
import type { NextApiRequest, NextApiResponse } from 'next';

function isValidHash(value: string): boolean {
	return /^[a-fA-F0-9]{40}$/.test(value);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
	const hash = typeof req.query.hash === 'string' ? req.query.hash : '';

	if (!hash) {
		return res.status(400).json({ message: 'Missing hash parameter' });
	}

	if (!isValidHash(hash)) {
		console.warn('Rejected torrent media info request due to invalid hash', { hash });
		return res.status(400).json({ message: 'Invalid hash format' });
	}

	try {
		const snapshot = await repository.getLatestTorrentSnapshot(hash);
		if (!snapshot) {
			console.info('No torrent snapshot available for media info', { hash });
			return res.status(404).json({ message: 'Not found' });
		}

		const mediaInfo = publicMediaInfo(snapshot.payload);
		if (!mediaInfo) {
			console.info('Torrent snapshot missing media info payload', { hash });
			return res.status(404).json({ message: 'Not found' });
		}

		return res.status(200).json(mediaInfo);
	} catch (error) {
		console.error('Failed to load torrent media info from snapshot', {
			hash,
			error: error instanceof Error ? error.message : String(error),
		});
		return res.status(500).json({ message: 'Internal server error' });
	}
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ message: 'Method not allowed' });
	}

	return handleGet(req, res);
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.torrents);
