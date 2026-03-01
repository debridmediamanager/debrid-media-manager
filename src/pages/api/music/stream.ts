import { NextApiRequest, NextApiResponse } from 'next';

export const config = {
	api: {
		responseLimit: false,
	},
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).end();
	}

	const { url, mime } = req.query;

	if (!url || typeof url !== 'string') {
		return res.status(400).json({ error: 'Missing url parameter' });
	}

	const mimeType = typeof mime === 'string' ? mime : 'audio/mpeg';

	try {
		const headers: Record<string, string> = {};

		// Forward range header for seeking support
		if (req.headers.range) {
			headers['Range'] = req.headers.range;
		}

		const upstream = await fetch(url, { headers });

		if (!upstream.ok && upstream.status !== 206) {
			return res.status(upstream.status).end();
		}

		res.setHeader('Content-Type', mimeType);
		res.setHeader('Accept-Ranges', 'bytes');

		const contentLength = upstream.headers.get('content-length');
		if (contentLength) {
			res.setHeader('Content-Length', contentLength);
		}

		const contentRange = upstream.headers.get('content-range');
		if (contentRange) {
			res.setHeader('Content-Range', contentRange);
		}

		res.status(upstream.status);

		const reader = upstream.body?.getReader();
		if (!reader) {
			return res.status(502).end();
		}

		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			res.write(value);
		}

		res.end();
	} catch (error) {
		console.error('[Music Stream] Error:', error);
		if (!res.headersSent) {
			res.status(502).json({ error: 'Failed to stream' });
		}
	}
}
