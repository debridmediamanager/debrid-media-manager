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
		if (ProxyManager.workingProxies.length > 5) {
			const randomProxy =
				ProxyManager.workingProxies[
					Math.floor(Math.random() * ProxyManager.workingProxies.length)
				];
			return new SocksProxyAgent(
				`socks5h://${randomProxy}:damama@${process.env.PROXY || ''}`,
				{ timeout: parseInt(process.env.REQUEST_TIMEOUT!) }
			);
		} else {
			this.myId = Math.random().toString(36).substring(2);
			ProxyManager.workingProxies.push(this.myId);
			return new SocksProxyAgent(`socks5h://${this.myId}:damama@${process.env.PROXY || ''}`, {
				timeout: parseInt(process.env.REQUEST_TIMEOUT!),
			});
		}
	}

	rerollProxy() {
		if (this.myId) this.removeProxy(this.myId);
		if (ProxyManager.workingProxies.length > 5) {
			this.myId =
				ProxyManager.workingProxies[
					Math.floor(Math.random() * ProxyManager.workingProxies.length)
				];
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
