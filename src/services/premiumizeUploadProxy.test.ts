// @vitest-environment node
// The fake upstream decodes multipart with Node's own Request.formData(), whose
// parser asserts on Node's File class. jsdom replaces the global File, so under
// jsdom every upload reads as an invalid body.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { forwardPremiumizeTorrentUpload } from './premiumizeUploadProxy';

const nativeFetch = globalThis.fetch;
let server: Server;
let upstreamUrl: string;
let requestCount: number;
let redirect: boolean;
let providerBody: unknown;
let uploadedFile: File | undefined;
let receivedFirstChunk: () => void;

beforeEach(async () => {
	requestCount = 0;
	redirect = false;
	providerBody = { status: 'success', id: 'transfer-1', name: 'sample', type: 'torrent' };
	uploadedFile = undefined;
	receivedFirstChunk = () => {};
	server = createServer(async (req, res) => {
		requestCount++;
		try {
			if (redirect) {
				req.resume();
				res.writeHead(307, { Location: `${upstreamUrl}/other-target` }).end();
				return;
			}
			async function* observedBody() {
				for await (const chunk of req) {
					receivedFirstChunk();
					yield chunk;
				}
			}
			const request = new Request(upstreamUrl, {
				method: 'POST',
				headers: { 'Content-Type': req.headers['content-type'] || '' },
				body: observedBody() as unknown as BodyInit,
				duplex: 'half',
			} as RequestInit & { duplex: 'half' });
			const form = await request.formData();
			uploadedFile = form.get('src') as File;
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(providerBody));
		} catch {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ status: 'error', message: 'Invalid multipart body.' }));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	upstreamUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	// Only replace DNS/routing; serialization, streaming and multipart decoding
	// run through the real Node HTTP stack rather than inspecting mock arguments.
	vi.stubGlobal('fetch', (_url: string, init: RequestInit) => nativeFetch(upstreamUrl, init));
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve()))
	);
});

const torrentBytes = new Uint8Array([0x64, 0x00, 0xff, 0x0d, 0x0a, 0x80, 0x65]);
const multipartBytes = Buffer.concat([
	Buffer.from(
		'--torrent-boundary\r\nContent-Disposition: form-data; name="src"; filename="sample.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n'
	),
	torrentBytes,
	Buffer.from('\r\n--torrent-boundary--\r\n'),
]);

async function* multipartBody() {
	yield multipartBytes;
}

it('streams before the source finishes and preserves binary file bytes across chunk boundaries', async () => {
	const firstChunkArrived = new Promise<void>((resolve) => {
		receivedFirstChunk = resolve;
	});
	async function* fragmentedBody() {
		const bytes = multipartBytes;
		yield bytes.subarray(0, 10);
		// A buffering proxy cannot advance here: the source waits for the
		// upstream to receive its first bytes before producing the rest.
		await firstChunkArrived;
		for (let offset = 10; offset < bytes.length; offset += 3) {
			yield bytes.subarray(offset, offset + 3);
		}
	}

	const result = await forwardPremiumizeTorrentUpload(
		'secret',
		'multipart/form-data; boundary="torrent-boundary"',
		fragmentedBody()
	);

	expect(result).toEqual({ httpStatus: 200, body: providerBody });
	expect(uploadedFile?.name).toBe('sample.torrent');
	expect(uploadedFile?.type).toBe('application/x-bittorrent');
	expect(new Uint8Array(await uploadedFile!.arrayBuffer())).toEqual(torrentBytes);
});

it.each([
	'application/json',
	'multipart/form-data; charset=utf-8',
	'multipart/form-data; boundary=""',
])('refuses %s without sending an upstream request', async (contentType) => {
	const result = await forwardPremiumizeTorrentUpload('secret', contentType, multipartBody());
	expect(result.httpStatus).toBe(415);
	expect(result.body.code).toBe('unsupported_media_type');
	expect(requestCount).toBe(0);
});

it('preserves provider business failures at HTTP 200', async () => {
	providerBody = { status: 'error', code: 'authentication_failed', message: 'Not logged in.' };
	const result = await forwardPremiumizeTorrentUpload(
		'badkey',
		'multipart/form-data; boundary=torrent-boundary',
		multipartBody()
	);
	expect(result).toEqual({ httpStatus: 200, body: providerBody });
});

it('does not follow an upload redirect outside the fixed target', async () => {
	redirect = true;
	const result = await forwardPremiumizeTorrentUpload(
		'secret',
		'multipart/form-data; boundary=torrent-boundary',
		multipartBody()
	);
	expect(result.httpStatus).toBe(502);
	expect(result.body.status).toBe('error');
	expect(requestCount).toBe(1);
});
