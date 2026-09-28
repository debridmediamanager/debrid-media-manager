import { TakedownService } from '@/services/database/takedown';
import { getClientIp } from '@/services/rateLimit/middlewareRateLimiter';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { MAX_NOTICE_ITEMS, parseNoticeLocations } from '@/utils/takedownParse';
import { NextApiHandler } from 'next';

const header = (value: string | string[] | undefined): string | null =>
	(Array.isArray(value) ? value[0] : value) ?? null;

const text = (value: unknown, max: number): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed && trimmed.length <= max ? trimmed : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let service: TakedownService | null = null;

// Files a copyright notice. Nothing is removed here: a notice waits for an
// operator's review, and approving it is what blocks what it names.
const handler: NextApiHandler = async (req, res) => {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const body = req.body ?? {};
	const claimantName = text(body.claimantName, 200);
	const claimantEmail = text(body.claimantEmail, 320);
	const representing = text(body.representing, 200);
	const work = text(body.work, 10_000);
	const reason = text(body.reason, 10_000);
	const locations = typeof body.locations === 'string' ? body.locations : '';
	const releaseNames = typeof body.releaseNames === 'string' ? body.releaseNames : '';

	if (!claimantName) return res.status(400).json({ error: 'Your name is required.' });
	if (!claimantEmail || !EMAIL.test(claimantEmail)) {
		return res.status(400).json({ error: 'A valid email address is required.' });
	}
	if (!work) return res.status(400).json({ error: 'Describe the work the notice concerns.' });
	if (!reason) return res.status(400).json({ error: 'Explain why the content is infringing.' });
	if (body.goodFaith !== true || body.accurate !== true) {
		return res
			.status(400)
			.json({ error: 'Both statements must be confirmed for a notice to be valid.' });
	}
	if (locations.length + releaseNames.length > 2_000_000) {
		return res.status(413).json({ error: 'Split a notice this large into several.' });
	}

	const parsed = parseNoticeLocations(locations, releaseNames);
	const count = parsed.hashes.length + parsed.releases.length + parsed.hashlistIds.length;
	if (count === 0) {
		return res.status(400).json({
			error: 'No infohash, magnet link, hash list URL or release name could be read from the notice.',
		});
	}
	if (count > MAX_NOTICE_ITEMS) {
		return res.status(413).json({
			error: `A notice can name up to ${MAX_NOTICE_ITEMS} items; split it into several.`,
		});
	}

	try {
		service ??= new TakedownService();
		const id = await service.createNotice({
			claimantName,
			claimantEmail,
			representing,
			work,
			reason,
			locations: [locations, releaseNames].filter(Boolean).join('\n\n'),
			...parsed,
			submitterIp: getClientIp(
				header(req.headers['cf-connecting-ip']),
				header(req.headers['x-real-ip']),
				header(req.headers['x-forwarded-for'])
			),
		});
		return res.status(201).json({
			id,
			hashes: parsed.hashes.length,
			releases: parsed.releases.length,
			hashlists: parsed.hashlistIds.length,
		});
	} catch (error) {
		console.error(
			'Takedown notice failed to save:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return res.status(500).json({ error: 'The notice could not be saved. Please try again.' });
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.takedown);
