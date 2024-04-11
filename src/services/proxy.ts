import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import UserAgent from 'user-agents';

export const createAxiosInstance = (agent: SocksProxyAgent) => {
	return axios.create({
		httpAgent: agent,
		headers: {
			accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'accept-language': 'en-US,en;q=0.5',
			'accept-encoding': 'gzip, deflate, br',
			connection: 'keep-alive',
			'sec-fetch-dest': 'document',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-site': 'same-origin',
			'sec-fetch-user': '?1',
			'upgrade-insecure-requests': '1',
			'user-agent': new UserAgent().toString(),
		},
		timeout: parseInt(process.env.REQUEST_TIMEOUT || '3000', 10),
	});
};
