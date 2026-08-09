import { getNzb2rdUrl } from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { MAX_NZB_BYTES, sabError, sabMode, sabTargetPath } from '@/services/sabnzbdProxy';
import type { NextApiRequest, NextApiResponse } from 'next';

// A SABnzbd download client for Radarr/Sonarr, backed by nzb2rd.
//
// See `@/services/sabnzbdProxy` for why this is a pass-through and why only
// `/api` paths may cross it. Configure *arr with:
//
//   Host      debridmediamanager.com     Port 443, SSL on
//   URL Base  api/sabnzbd/<mount root>   e.g. api/sabnzbd/mnt/zurg/__all__
//   API Key   the user's Real-Debrid API key
//
// The mount root is the user's own zurg/rclone path; it is what nzb2rd names in
// history so *arr can import the finished release. Windows users leave it out of
// the URL Base and set the Username field to `D:\zurg` instead.

// The body is a multipart NZB upload on `mode=addfile` and must reach nzb2rd
// byte-for-byte, so Next must not parse it into `req.body` first.
export const config = { api: { bodyParser: false } };

/**
 * Buffer the raw request body, refusing anything over the cap.
 *
 * Flattened into one `Uint8Array` rather than handed over as a Buffer: a Node
 * Buffer is backed by `ArrayBufferLike`, which `fetch` will not take as a body.
 * The copy costs nothing in practice — this runs on `addfile` only, once per
 * grab, never on a poll.
 */
async function readBody(req: NextApiRequest): Promise<Uint8Array<ArrayBuffer> | null> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of req) {
		const bytes: Uint8Array = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.byteLength;
		if (size > MAX_NZB_BYTES) return null;
		chunks.push(bytes);
	}

	const body = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		body.set(chunk, at);
		at += chunk.byteLength;
	}
	return body;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	// GET covers version, get_config, queue, history and the queue/history
	// delete; POST is only ever `mode=addfile`.
	if (req.method !== 'GET' && req.method !== 'POST') {
		return res.status(405).json(sabError('Method not allowed'));
	}

	const target = sabTargetPath(req.url);
	if (!target) return res.status(404).json(sabError('Not a SABnzbd API path'));

	let body: Uint8Array<ArrayBuffer> | undefined;
	if (req.method === 'POST') {
		const read = await readBody(req);
		if (read === null) return res.status(413).json(sabError('NZB is too large'));
		body = read;
	}

	// Only the content type crosses: the rest of the incoming headers are the
	// browser-shaped ones DMM's own clients send, and nzb2rd has no use for them.
	const headers: Record<string, string> = { Accept: 'application/json' };
	const contentType = req.headers['content-type'];
	if (contentType) headers['Content-Type'] = contentType;

	console.log(`[sabnzbd] mode=${sabMode(req.url)}`);

	try {
		const response = await fetch(`${getNzb2rdUrl()}${target}`, {
			method: req.method,
			headers,
			body,
			// addfile costs a Real-Debrid key check on nzb2rd's side; a poll does not.
			signal: AbortSignal.timeout(req.method === 'POST' ? 30000 : 15000),
		});
		const text = await response.text();
		res.status(response.status);
		res.setHeader('Content-Type', response.headers.get('content-type') ?? 'application/json');
		return res.send(text);
	} catch (error) {
		console.error('nzb2rd SABnzbd proxy failed:', error);
		// 200, per `sabError`: *arr surfaces this message to the user as-is.
		return res.status(200).json(sabError('nzb2rd is unreachable'));
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
