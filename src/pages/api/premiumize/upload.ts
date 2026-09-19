import { readApiKey } from '@/services/premiumizeProxy';
import { forwardPremiumizeTorrentUpload } from '@/services/premiumizeUploadProxy';
import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Cache-Control', 'no-store, private');
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ status: 'error', code: 'method_not_allowed' });
	}
	const apiKey = readApiKey(req.headers.authorization);
	if (!apiKey) {
		return res
			.status(401)
			.json({ status: 'error', code: 'authentication_failed', message: 'Missing API key.' });
	}
	const contentType = req.headers['content-type'] || '';
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
	}
	const result = await forwardPremiumizeTorrentUpload(
		apiKey,
		contentType,
		new Uint8Array(Buffer.concat(chunks))
	);
	return res.status(result.httpStatus).json(result.body);
}
