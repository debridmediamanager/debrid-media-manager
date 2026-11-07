import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { answersAsMachine } from './rexDirectReach';

const MACHINE = '62d9642bbf1151aebbc4a3c6f89a8f1b343e5625';
let server: Server | undefined;

async function serve(status: number, body: string): Promise<number> {
	server = createServer((req, res) => {
		res.writeHead(req.url === '/identity' ? status : 404, { 'Content-Type': 'text/xml' });
		res.end(body);
	});
	await new Promise<void>((resolve) => server!.listen(0, '::1', resolve));
	return (server.address() as AddressInfo).port;
}

afterEach(
	() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
);

// rex's own /identity, as zen's test server answered it on 2026-11-06.
const identity = (machine: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<MediaContainer size="0" apiVersion="1.2.3" claimed="1" machineIdentifier="${machine}" version="1.43.5.11079-b3b13e506">\n</MediaContainer>\n`;

describe('answersAsMachine', () => {
	it('finds the same server at the address', async () => {
		const port = await serve(200, identity(MACHINE));
		expect(await answersAsMachine('::1', port, MACHINE)).toBe(true);
	});

	it('refuses another server at the address', async () => {
		const port = await serve(200, identity('45d6b93c3f472650d0a3830d5d3415819ec7bfc1'));
		expect(await answersAsMachine('::1', port, MACHINE)).toBe(false);
	});

	it('refuses an error answer', async () => {
		const port = await serve(500, identity(MACHINE));
		expect(await answersAsMachine('::1', port, MACHINE)).toBe(false);
	});

	it('refuses when nothing listens', async () => {
		const port = await serve(200, identity(MACHINE));
		await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = undefined;
		expect(await answersAsMachine('::1', port, MACHINE)).toBe(false);
	});
});
