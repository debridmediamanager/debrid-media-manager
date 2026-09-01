import { orderedServersForNewJob } from '@/services/debridUploaderServers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getToken } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { canClaim, pickSourceKeys, RequestValidationError } from '@/utils/contentRequest';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Fulfil somebody else's request.
 *
 * The caller brings the half the asker lacks — a TorBox or AllDebrid account
 * with the release cached — and the asker's stored Real-Debrid credentials
 * supply the other half. The uploader has always accepted a destination key and
 * a source key without caring whether they belong to the same person, so this
 * route is the matchmaking, not a new capability.
 *
 * The fulfiller's key is passed straight through and never stored here. It
 * lives on the uploader host only for the life of the job, which is what
 * `clearJobSecrets` on the debrid side now guarantees.
 */

const RD_TOKEN_HEADER = 'x-rd-access-token';

function readToken(req: NextApiRequest): string | null {
	const header = req.headers[RD_TOKEN_HEADER];
	const token = Array.isArray(header) ? header[0] : header;
	return typeof token === 'string' && token.trim() !== '' ? token.trim() : null;
}

/**
 * A Real-Debrid access token for the *requester*, minted now.
 *
 * Not the token they filed the request with. Real-Debrid expires an access
 * token 24 hours after minting, and a request may sit on the board for days —
 * nzb2rd learned this the expensive way, where stale tokens were 1298 of 1952
 * Usenet failures. The OAuth triple in `CastProfile` does not expire, so the
 * token is minted at the moment of fulfilment instead of being carried.
 */
async function mintRequesterToken(requesterId: string): Promise<string | null> {
	const profile = await db.getCastProfile(requesterId);
	if (!profile?.clientId || !profile?.clientSecret || !profile?.refreshToken) return null;
	try {
		const token = await getToken(
			profile.clientId,
			profile.clientSecret,
			profile.refreshToken,
			true
		);
		return token?.access_token ?? null;
	} catch (error) {
		// Only the message: an AxiosError expands to include `config.data`, which
		// here is the OAuth POST body — the triple itself.
		console.error(
			'Minting a Real-Debrid token for a request failed:',
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const id = req.query.id;
	if (typeof id !== 'string' || id === '') {
		return res.status(400).json({ error: 'request id is required' });
	}

	const token = readToken(req);
	if (!token) {
		return res.status(401).json({ error: 'A Real-Debrid session is required to fulfil' });
	}

	let fulfillerId: string;
	try {
		fulfillerId = await generateUserId(token);
	} catch {
		return res.status(401).json({ error: 'Real-Debrid session is not valid' });
	}

	let sourceKeys: { tb_api_key: string };
	try {
		const { tbKey } = (req.body ?? {}) as { tbKey?: string };
		sourceKeys = pickSourceKeys({ torboxApiKey: tbKey });
	} catch (error) {
		if (error instanceof RequestValidationError) {
			return res.status(400).json({ error: error.message });
		}
		throw error;
	}

	const request = await db.getContentRequest(id);
	if (!request) return res.status(404).json({ error: 'request not found' });

	const verdict = canClaim(request, fulfillerId);
	if (!verdict.ok) return res.status(verdict.code).json({ error: verdict.reason });

	// Claim before doing any work. The status is part of the update's `where`,
	// so if two fulfillers arrive together the database picks one and the other
	// is told the request is taken — rather than both spending their own quota
	// fetching the same release.
	const claimed = await db.claimContentRequest(id, fulfillerId);
	if (!claimed) return res.status(409).json({ error: 'somebody else just took this request' });

	const requesterToken = await mintRequesterToken(request.requesterId);
	if (!requesterToken) {
		await db.releaseContentRequest(id, 'the requester has no usable Real-Debrid credentials');
		return res.status(409).json({
			error: 'the requester needs to reconnect Real-Debrid before this can be fulfilled',
		});
	}

	const body = JSON.stringify({
		input: `magnet:?xt=urn:btih:${request.hash}`,
		imdb_id: request.imdbId,
		rd_api_key: requesterToken,
		...sourceKeys,
	});

	let lastNetworkError = false;
	for (const server of orderedServersForNewJob(undefined)) {
		let response: Response;
		try {
			response = await fetch(`${server}/jobs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				signal: AbortSignal.timeout(30000),
			});
		} catch (error) {
			console.error(`Debrid uploader ${server} unreachable, trying next:`, error);
			lastNetworkError = true;
			continue;
		}

		const data = await response.json().catch(() => ({}));
		if (response.ok && data?.id) {
			await Promise.all([
				db.attachContentRequestJob(id, data.id, server),
				db
					.recordDebridJobServer(data.id, server)
					.catch((e) => console.error('Recording job server failed:', e)),
				// Filed under the *requester*, because the transfer lands in their
				// Real-Debrid account and the Transfers page keys on that.
				db
					.recordTransferMeta({
						source: 'debrid',
						jobId: data.id,
						imdbId: request.imdbId,
						title: request.title ?? undefined,
					})
					.catch((e) => console.error('Recording transfer context failed:', e)),
			]);
			return res.status(200).json({ jobId: data.id });
		}

		// The uploader refused it — a deterministic answer, so stop and hand the
		// request back to the board rather than retrying it on another host.
		const reason =
			typeof data?.error === 'string' ? data.error : `uploader answered ${response.status}`;
		await db.releaseContentRequest(id, reason);
		return res.status(response.status).json({ error: reason });
	}

	await db.releaseContentRequest(
		id,
		lastNetworkError ? 'all uploader hosts unreachable' : 'no uploader host available'
	);
	return res.status(502).json({
		error: lastNetworkError ? 'All debrid uploader servers unreachable' : 'no server',
	});
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
