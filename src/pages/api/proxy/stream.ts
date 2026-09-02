import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { validateProblemToken } from '@/utils/problemToken';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'node:crypto';
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

// This endpoint spends dmm's own resources on the caller's behalf - a Tor
// circuit out of dmm-01 and a slice of the per-IP budget - so it is meant for
// the site's own search pages and nothing else. Two gates keep it there:
// a browser is refused outright if it says the call came from somewhere other
// than dmm, and every caller has to present a token this server signed.
//
// Neither makes the endpoint unscriptable; the allowlist above is what keeps a
// forged caller from reaching anything but the five addons.
function isForeignBrowserRequest(req: NextApiRequest): boolean {
	// Sent by every current browser and unsettable from page script. Absent for
	// older browsers and non-browser callers, who fall through to the token.
	const site = req.headers['sec-fetch-site'];
	return typeof site === 'string' && site !== 'same-origin';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	if (isForeignBrowserRequest(req)) {
		return res.status(403).json({ error: 'Forbidden' });
	}

	const { url, service, dmmProblemKey, solution } = req.query;

	if (!validateProblemToken(dmmProblemKey, solution)) {
		return res.status(403).json({ error: 'Authentication error' });
	}

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
			// Tor isolates circuits on the SOCKS username, so this is what decides
			// whether two requests leave from the same exit IP. It used to be
			// Date.now(), which is only millisecond-granular: a burst handled
			// inside one millisecond shared a circuit, and a search page fans out
			// ten of these at once - measured 3 distinct stamps across a 10-request
			// burst, so 7 of them went out from an exit another request was
			// already using. A random id gives each request its own.
			const torProxy = new SocksProxyAgent(
				`socks5h://${randomUUID()}:any_password@${process.env.PROXY || 'localhost:9050'}`,
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
