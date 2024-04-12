import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import UserAgent from 'user-agents';

export const createAxiosInstance = (agent: SocksProxyAgent) => {
	return axios.create({
		httpAgent: agent,
		httpsAgent: agent,
		headers: {
			'user-agent': new UserAgent().toString(),
		},
		timeout: parseInt(process.env.REQUEST_TIMEOUT || '3000', 10),
	});
};
