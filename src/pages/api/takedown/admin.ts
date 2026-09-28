import { TakedownService, type TakedownStatus } from '@/services/database/takedown';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { invalidateBlocklist } from '@/services/takedown/blocklist';
import { deleteHashlistPages } from '@/services/takedown/hashlists';
import { timingSafeEqual } from 'crypto';
import { NextApiHandler, NextApiRequest } from 'next';

const STATUSES: TakedownStatus[] = ['pending', 'approved', 'rejected'];

export const isTakedownAdmin = (req: NextApiRequest): boolean => {
	const expected = process.env.TAKEDOWN_ADMIN_TOKEN;
	const header = req.headers.authorization;
	if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
	const given = Buffer.from(header.slice('Bearer '.length));
	const want = Buffer.from(expected);
	return given.length === want.length && timingSafeEqual(given, want);
};

let service: TakedownService | null = null;

// The review queue. GET lists notices; POST approves or rejects one. Rejecting
// an approved notice reverses it.
const handler: NextApiHandler = async (req, res) => {
	if (!isTakedownAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
	service ??= new TakedownService();

	if (req.method === 'GET') {
		const status = STATUSES.find((s) => s === req.query.status);
		const notices = await service.listNotices(status);
		return res.status(200).json({ notices });
	}

	if (req.method !== 'POST') {
		res.setHeader('Allow', 'GET, POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id, action, note } = req.body ?? {};
	if (typeof id !== 'string' || (action !== 'approve' && action !== 'reject')) {
		return res.status(400).json({ error: 'id and action (approve|reject) are required' });
	}
	const reviewNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 5000) : null;

	const existing = await service.getNotice(id);
	if (!existing) return res.status(404).json({ error: 'Notice not found' });

	if (action === 'reject') {
		const notice = await service.rejectNotice(id, reviewNote);
		invalidateBlocklist();
		return res.status(200).json({ notice });
	}

	const notice = await service.approveNotice(id, reviewNote);
	invalidateBlocklist();
	// The hashes are blocked either way; a GitHub failure leaves the share
	// pages for a retry (approving again is idempotent) rather than undoing it.
	let hashlists: { deleted: string[]; missing: string[] } | { error: string };
	try {
		hashlists = await deleteHashlistPages(notice.hashlistIds, id);
	} catch (error) {
		hashlists = { error: error instanceof Error ? error.message : 'Unknown error' };
	}
	return res.status(200).json({ notice, hashlists });
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.takedownAdmin);
