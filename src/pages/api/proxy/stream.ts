import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import { SocksProxyAgent } from 'socks-proxy-agent';

const ALLOWED_HOSTS = [
	'comet.elfhosted.com',
	'mediafusion.elfhosted.com',
	'torrentsdb.com',
	'addon.peerflix.mov',
	'torrentio.strem.fun',
];

const TOR_SERVICES = [
	'comet-tor',
	'mediafusion-tor',
	'peerflix-tor',
	'torrentsdb-tor',
	'torrentio-tor',
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { url, service } = req.query;

	if (!url || typeof url !== 'string') {
		return res.status(400).json({ error: 'URL parameter is required' });
	}

	if (!service || typeof service !== 'string') {
		return res.status(400).json({ error: 'Service parameter is required' });
	}

	try {
		const urlObj = new URL(url);

		if (!ALLOWED_HOSTS.includes(urlObj.hostname)) {
			return res.status(400).json({ error: 'Host not allowed' });
		}

		const useTor = TOR_SERVICES.includes(service);
		let response;

		if (useTor) {
			const torProxy = new SocksProxyAgent(
				`socks5h://${Date.now()}:any_password@${process.env.PROXY || 'localhost:9050'}`,
				{
					timeout: parseInt(process.env.REQUEST_TIMEOUT!) || 30000,
				}
			);

			response = await axios.get(url, {
				httpAgent: torProxy,
				httpsAgent: torProxy,
				headers: {
					referer: 'https://web.stremio.com/',
					'user-agent':
						'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
				},
				timeout: 30000,
			});
		} else {
			response = await axios.get(url, {
				headers: {
					referer: 'https://web.stremio.com/',
					'user-agent':
						'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
				},
				timeout: 30000,
			});
		}

		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Cache-Control', 'no-cache');
		return res.status(200).json(response.data);
	} catch (error) {
		console.error(`Proxy request failed for ${service}:`, error);

		if (axios.isAxiosError(error)) {
			const status = error.response?.status || 500;
			const message = error.response?.data || error.message;
			return res.status(status).json({ error: message });
		}

		return res.status(500).json({ error: 'Internal server error' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.proxy);
