// @vitest-environment node
import Client, * as trackerPackage from 'bittorrent-tracker';
import { execFileSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { torrentScraper } from './torrentScraper';

const fixture = vi.hoisted(() => ({ trackers: [] as string[] }));
// Only discovery is replaced: every URL belongs to this test; no public tracker list,
// DNS lookup, account, canned scrape callback, or mocked tracker client is used.
vi.mock('./trackerManager', () => ({
	trackerManager: { getTrackers: async () => fixture.trackers },
}));

const hash = 'abcdef0123456789abcdef0123456789abcdef01';
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
	fixture.trackers = [];
	for (const close of cleanup.splice(0).reverse()) await close();
});

interface LocalTrackerServer extends EventEmitter {
	http: http.Server;
	udp4: { address(): AddressInfo };
	listen(port: number, hostname: { http: string; udp: string; udp6: string }): void;
	close(callback: (error?: Error) => void): void;
	onHttpRequest(request: http.IncomingMessage, response: http.ServerResponse): void;
}
// The repository's existing ambient Client-only declaration omits upstream Server.
const { Server } = trackerPackage as unknown as {
	Server: new (options: Record<string, boolean>) => LocalTrackerServer;
};

function nextUpdate(client: Client) {
	return new Promise<void>((resolve) => {
		client.on('update', () => resolve());
	});
}
async function tracker(protocol: 'http' | 'udp' | 'ws') {
	// Exercise the published ESM Server, not a replacement protocol
	// encoder. Port zero asks the OS for a free loopback port (no fixed port race).
	const server = new Server({
		http: protocol === 'http',
		udp: protocol === 'udp',
		ws: protocol === 'ws',
		stats: false,
	});
	const errors: Error[] = [];
	server.on('error', (error: Error) => errors.push(error));
	const listening = once(server, 'listening');
	server.listen(0, { http: '127.0.0.1', udp: '127.0.0.1', udp6: '::1' });
	cleanup.push(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error?: Error) => (error ? reject(error) : resolve()));
			})
	);
	await listening;
	const socket = protocol === 'udp' ? server.udp4 : server.http;
	const port = (socket.address() as AddressInfo).port;
	return { server, errors, url: `${protocol}://127.0.0.1:${port}/announce` };
}

async function announce(url: string, index: number, left: number) {
	const client = new Client({
		announce: [url],
		infoHash: hash,
		peerId: Buffer.from(`-DM0001-${String(index).padStart(12, '0')}`),
		port: 20000 + index,
	});
	cleanup.push(() => new Promise<void>((resolve) => client.destroy(resolve)));
	const updated = nextUpdate(client);
	client.start({ left });
	await updated;
	return client;
}

async function plainHttp(handler: http.RequestListener) {
	const server = http.createServer(handler);
	server.listen(0, '127.0.0.1');
	cleanup.push(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			})
	);
	await once(server, 'listening');
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}/announce`;
}

describe('torrentScraper real local tracker compatibility (Integration)', () => {
	it.each(['http', 'udp'] as const)(
		'decodes %s scrape counts derived from real started/completed/stopped announces',
		async (protocol) => {
			const owned = await tracker(protocol);
			const completing = await announce(owned.url, 1, 100);
			await announce(owned.url, 2, 100);
			const departing = await announce(owned.url, 3, 0);
			const completed = nextUpdate(completing);
			completing.complete({ left: 0 });
			await completed;
			const stopped = nextUpdate(departing);
			departing.stop({ left: 0 });
			await stopped;
			fixture.trackers = [owned.url];
			// Published Server reports downloaded=complete (a lower bound), not an
			// independently persisted lifetime download counter. Do not invent one.
			expect(await torrentScraper.scrapeTorrent(hash)).toEqual({
				seeders: 1,
				leechers: 1,
				downloads: 1,
				successfulTrackers: 1,
				totalTrackers: 1,
			});
			expect(owned.errors).toEqual([]);
		},
		15000
	);

	it('takes maxima rather than sums across HTTP/UDP and preserves mixed failures', async () => {
		const httpTracker = await tracker('http');
		const udpTracker = await tracker('udp');
		await announce(httpTracker.url, 11, 0);
		await announce(httpTracker.url, 12, 0);
		await announce(httpTracker.url, 13, 1);
		await announce(udpTracker.url, 21, 0);
		await announce(udpTracker.url, 22, 1);
		await announce(udpTracker.url, 23, 1);
		const failure = await plainHttp((_request, response) => {
			response.writeHead(503);
			response.end('Task-owned unavailable tracker');
		});
		fixture.trackers = [httpTracker.url, udpTracker.url, failure];
		expect(await torrentScraper.scrapeTorrent(hash)).toEqual({
			seeders: 2,
			leechers: 2,
			downloads: 2,
			successfulTrackers: 2,
			totalTrackers: 3,
		});
		expect([...httpTracker.errors, ...udpTracker.errors]).toEqual([]);
	}, 15000);

	it('returns zero successes for an actual HTTP failure', async () => {
		fixture.trackers = [
			await plainHttp((_request, response) => {
				response.writeHead(503);
				response.end();
			}),
		];
		expect(await torrentScraper.scrapeTorrent(hash)).toEqual({
			seeders: 0,
			leechers: 0,
			downloads: 0,
			successfulTrackers: 0,
			totalTrackers: 1,
		});
	});

	it('keeps the ten-second consumer deadline while another real tracker succeeds', async () => {
		const owned = await tracker('http');
		await announce(owned.url, 31, 0);
		let release!: () => void;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		const delayed = await plainHttp((request, response) => {
			// Release the real upstream response after DMM's own deadline. This
			// lets the upstream static scrape finish and close its internal client.
			setTimeout(() => {
				owned.server.onHttpRequest(request, response);
				release();
			}, 10250);
		});
		fixture.trackers = [owned.url, delayed];
		const started = Date.now();
		try {
			expect(await torrentScraper.scrapeTorrent(hash)).toEqual({
				seeders: 1,
				leechers: 0,
				downloads: 1,
				successfulTrackers: 1,
				totalTrackers: 2,
			});
			expect(Date.now() - started).toBeGreaterThanOrEqual(9900);
		} finally {
			await released;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}, 20000);

	it('scrapes a real WebSocket tracker using the native Node client support', async () => {
		const owned = await tracker('ws');
		// The published client supplies native WebRTC support by default.
		// Scraping this empty local swarm does not require a peer connection.
		fixture.trackers = [owned.url];
		expect(await torrentScraper.scrapeTorrent(hash)).toEqual({
			seeders: 0,
			leechers: 0,
			downloads: 0,
			successfulTrackers: 1,
			totalTrackers: 1,
		});
	});
});

describe('tracker IP dependency native runtime contract (Integration)', () => {
	// bittorrent-tracker/lib/server/parse-udp.js imports default `ip` and calls
	// toString with the announce's optional IPv4 field, a uint32. That is the whole
	// contract. Load it as the tracker does, in Node rather than Vitest interop.
	it('serves parse-udp from the tracker dependency boundary', () => {
		const script = `
			import assert from 'node:assert/strict';
			import { createRequire } from 'node:module';
			import { pathToFileURL } from 'node:url';
			const require = createRequire(import.meta.resolve('bittorrent-tracker'));
			const ip = (await import(pathToFileURL(require.resolve('ip')).href)).default;
			assert.equal(ip.toString(0x7f000001), '127.0.0.1');
			assert.equal(ip.toString(Buffer.from([127, 0, 0, 1])), '127.0.0.1');
			assert.equal(ip.toString(Buffer.from('20014860486000000000000000008888', 'hex')), '2001:4860:4860::8888');
			// The advisory (GHSA-2p57-rm9w-gvfp) is in isPublic: nothing here may offer it.
			assert.equal(ip.isPublic, undefined);
		`;
		expect(() =>
			execFileSync(process.execPath, ['--input-type=module', '-e', script], {
				cwd: process.cwd(),
				timeout: 10000,
				stdio: 'pipe',
			})
		).not.toThrow();
	});
});
