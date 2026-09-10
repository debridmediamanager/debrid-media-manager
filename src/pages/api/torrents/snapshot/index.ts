import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { TorrentSnapshot, toStoredSnapshot } from '@/utils/torrentSnapshot';
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
	api: {
		bodyParser: {
			sizeLimit: '10mb',
		},
	},
};

function getSharedSecret() {
	return process.env.ZURGTORRENT_SYNC_SECRET;
}

function deriveSnapshotId(hash: string, added: unknown): { id: string; date: Date } {
	let datePart = '';
	if (typeof added === 'string' && added.length >= 10) {
		datePart = added.slice(0, 10);
	}
	if (!datePart) {
		datePart = new Date().toISOString().slice(0, 10);
	}
	let addedDate = new Date(datePart);
	if (Number.isNaN(addedDate.getTime()) && typeof added === 'string') {
		addedDate = new Date(added);
	}
	if (Number.isNaN(addedDate.getTime())) {
		addedDate = new Date();
	}
	return {
		id: `${hash}:${datePart}`,
		date: addedDate,
	};
}

function isValidHash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/.test(hash);
}

function generatePassword(hash: string, salt: string): string {
	return crypto
		.createHash('sha1')
		.update(hash + salt)
		.digest('hex');
}

// Any zurg may post, with or without a token: zurg sends its user's own DMM
// key, and older builds reach here through zurgtorrent-worker. The shape check
// and the allowlist in toStoredSnapshot are what keep junk and account data out.
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
	const result = TorrentSnapshot.try(req.body);
	if (!result.ok) {
		// Every failing path, not just the first: "(+ 2 other issues)" hid whether
		// a refused release was half-analyzed or only carried an unprobed sidecar.
		console.warn('Rejected torrent snapshot', {
			issues: result.issues
				.slice(0, 5)
				.map((issue) => `${issue.code} at .${issue.path.join('.')}`),
		});
		return res.status(400).json({ message: 'Invalid torrent snapshot', issue: result.message });
	}

	const snapshot = toStoredSnapshot(result.value);
	try {
		const { id, date } = deriveSnapshotId(snapshot.Hash, snapshot.Added);
		await repository.upsertTorrentSnapshot({
			id,
			hash: snapshot.Hash,
			addedDate: date,
			payload: snapshot,
		});
		return res.status(201).json({ success: true, id });
	} catch (error) {
		console.error('Failed to persist torrent snapshot', error);
		return res.status(500).json({ message: 'Internal server error' });
	}
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
	const sharedSecret = getSharedSecret();
	if (!sharedSecret) {
		console.error('Missing ZURGTORRENT_SYNC_SECRET environment variable');
		return res.status(500).json({ message: 'Server misconfiguration' });
	}

	const hashParam = req.query.hash;
	const password = req.query.password;

	if (typeof hashParam !== 'string' || typeof password !== 'string') {
		return res.status(400).json({ message: 'Missing required parameters' });
	}

	if (!isValidHash(hashParam)) {
		return res.status(400).json({ message: 'Invalid hash format' });
	}

	const expected = generatePassword(hashParam, sharedSecret);
	if (password !== expected) {
		console.warn('Rejected torrent snapshot request due to invalid password');
		return res.status(401).json({ message: 'Unauthorized' });
	}

	try {
		const snapshot = await repository.getLatestTorrentSnapshot(hashParam);

		if (!snapshot) {
			return res.status(404).json({ message: 'Not found' });
		}

		return res.status(200).json(snapshot.payload);
	} catch (error) {
		console.error('Failed to load torrent snapshot', error);
		return res.status(500).json({ message: 'Internal server error' });
	}
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method === 'POST') {
		return handlePost(req, res);
	}
	if (req.method === 'GET') {
		return handleGet(req, res);
	}
	return res.status(405).json({ message: 'Method not allowed' });
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.snapshot);
