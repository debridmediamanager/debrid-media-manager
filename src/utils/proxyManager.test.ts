import { SocksProxyAgent } from 'socks-proxy-agent';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import ProxyManager from './proxyManager';

type AgentMock = {
	url: string;
	opts: Record<string, unknown>;
};

const asAgent = (value: unknown) => value as AgentMock;

vi.mock('socks-proxy-agent', () => ({
	SocksProxyAgent: vi.fn().mockImplementation(function (url: string, opts: AgentMock['opts']) {
		return { url, opts };
	}),
}));

const socksAgentMock = SocksProxyAgent as unknown as Mock;

describe('ProxyManager', () => {
	beforeEach(() => {
		ProxyManager.workingProxies = [];
		ProxyManager.nonWorkingProxies = [];
		process.env.PROXY = 'proxy.example:1080';
		process.env.REQUEST_TIMEOUT = '15000';
		socksAgentMock.mockClear();
	});

	it('reuses an existing working proxy when the pool is large', () => {
		ProxyManager.workingProxies = Array.from({ length: 12 }, (_, index) => `proxy-${index}`);
		const mathSpy = vi.spyOn(Math, 'random').mockReturnValue(0.25);

		const manager = new ProxyManager();
		socksAgentMock.mockClear();

		const agent = asAgent(manager.getWorkingProxy());
		expect(agent.url).toBe('socks5h://proxy-3:damama@proxy.example:1080');
		expect(agent.opts).toEqual({ timeout: 15000 });
		expect(socksAgentMock).toHaveBeenCalledWith('socks5h://proxy-3:damama@proxy.example:1080', {
			timeout: 15000,
		});

		mathSpy.mockRestore();
	});

	it('registers a fresh proxy id when the pool is small', () => {
		const mathSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const manager = new ProxyManager();
		socksAgentMock.mockClear();

		const agent = asAgent(manager.getWorkingProxy());
		expect(agent.url).toMatch(/^socks5h:\/\/[0-9a-z]+:damama@proxy\.example:1080$/);
		expect(ProxyManager.workingProxies.length).toBe(2);

		mathSpy.mockRestore();
	});

	it('creates a TOR proxy agent using the fallback host and timeout', () => {
		const originalProxy = process.env.PROXY;
		const originalTimeout = process.env.REQUEST_TIMEOUT;
		delete process.env.PROXY;
		delete process.env.REQUEST_TIMEOUT;

		const manager = new ProxyManager();
		socksAgentMock.mockClear();

		const torAgent = asAgent(manager.getTorProxy());
		expect(torAgent.url).toBe('socks5h://any_username:any_password@localhost:9050');
		expect(torAgent.opts).toEqual({ timeout: 30000 });

		if (originalProxy) process.env.PROXY = originalProxy;
		if (originalTimeout) process.env.REQUEST_TIMEOUT = originalTimeout;
	});

	it('rerolls proxies that are marked as non-working', () => {
		const existing = ['a', 'b', 'c', 'd', 'e', 'bad-proxy'];
		ProxyManager.workingProxies = [...existing];
		ProxyManager.nonWorkingProxies = ['bad-proxy'];
		const mathSpy = vi.spyOn(Math, 'random').mockReturnValueOnce(0.99).mockReturnValue(0.1);

		new ProxyManager();

		const newEntries = ProxyManager.workingProxies.filter((value) => !existing.includes(value));
		expect(newEntries.length).toBe(1);
		expect(
			ProxyManager.nonWorkingProxies.filter((value) => value === 'bad-proxy').length
		).toBeGreaterThan(1);
		expect(ProxyManager.workingProxies.length).toBe(6);

		mathSpy.mockRestore();
	});
});
