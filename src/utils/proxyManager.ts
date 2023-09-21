import { SocksProxyAgent } from 'socks-proxy-agent';

class ProxyManager {
	static workingProxies: string[] = [];
	static nonWorkingProxies: string[] = [];
	private myId: string;

	constructor() {
		this.myId = '';
		this.rerollProxy();
	}

	getWorkingProxy(): SocksProxyAgent {
		if (ProxyManager.workingProxies.length > 0) {
			return new SocksProxyAgent(
				`socks5h://${ProxyManager.workingProxies[0]}:damama@${process.env.PROXY || ''}`,
				{ timeout: parseInt(process.env.REQUEST_TIMEOUT!) }
			);
		} else {
			throw new Error('No working proxies');
		}
	}

	rerollProxy() {
		if (this.myId) this.removeProxy(this.myId);
		if (ProxyManager.workingProxies.length > 0) {
			this.myId = ProxyManager.workingProxies[0];
		} else {
			this.myId = Math.random().toString(36).substring(2);
			ProxyManager.workingProxies.push(this.myId);
		}
		if (ProxyManager.nonWorkingProxies.includes(this.myId)) this.rerollProxy();
	}

	private removeProxy(proxyId: string) {
		const index = ProxyManager.workingProxies.indexOf(proxyId);
		if (index > -1) {
			ProxyManager.workingProxies.splice(index, 1);
		}
		ProxyManager.nonWorkingProxies.push(proxyId);
	}
}

export default ProxyManager;
