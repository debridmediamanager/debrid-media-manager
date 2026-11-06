import { isDlFinished, listAllSeedboxTorrents } from '@/services/debridLink';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getUserTorrentsList } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiRequest, NextApiResponse } from 'next';

const RD_PAGE = 5000;
/** 100k torrents; an account past that keeps its newest refreshed. */
const RD_MAX_PAGES = 20;

/**
 * POST /api/availability/refresh
 * Keep the recorded releases a member holds in Cast's window. Cast offers a release only while
 * its record is fresh, and a library visit skips every release DMM already knows, so releases
 * members hold aged out of Cast. The page sends its key; DMM reads the library from the provider
 * itself (one listing) and refreshes the records of what it finds there whole, as
 * `/api/availability` reads a torrent. Real-Debrid and Debrid-Link only: AllDebrid refuses those
 * reads from DMM's servers, and its records refresh when a Cast play of them works.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!validateOwnPageRequest(req, res)) return;

	const { dmmProblemKey, solution, service, key } = req.body ?? {};
	if (typeof dmmProblemKey !== 'string' || typeof solution !== 'string') {
		return res.status(403).json({ errorMessage: 'Authentication not provided' });
	} else if (!validateProblemToken(dmmProblemKey, solution)) {
		return res.status(403).json({ errorMessage: 'Authentication error' });
	}
	if (service !== 'rd' && service !== 'dl') {
		return res.status(400).json({ error: 'Service must be rd or dl' });
	}
	if (typeof key !== 'string' || !key.trim()) {
		return res.status(400).json({ error: 'Missing provider key' });
	}

	let whole: string[];
	try {
		if (service === 'rd') {
			whole = [];
			for (let page = 1; page <= RD_MAX_PAGES; page++) {
				const { data } = await getUserTorrentsList(key, RD_PAGE, page, true);
				for (const t of data) {
					if (t.status === 'downloaded' && t.progress === 100)
						whole.push(t.hash.toLowerCase());
				}
				if (data.length < RD_PAGE) break;
			}
		} else {
			whole = (await listAllSeedboxTorrents(key))
				.filter((t) => isDlFinished(t.status) || t.downloadPercent >= 100)
				.map((t) => t.hashString.toLowerCase());
		}
	} catch {
		return res.status(502).json({ error: 'The provider did not list the library' });
	}

	try {
		const refreshed =
			service === 'rd'
				? await db.refreshAvailability(whole)
				: await db.refreshAvailabilityDl(whole);
		return res.status(200).json({ refreshed });
	} catch (error) {
		console.error(
			'Error refreshing availability:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return res.status(500).json({ error: 'Failed to refresh availability' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.availabilityWrite);
