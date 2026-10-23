import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf-8'));

// `ip` (GHSA-2p57-rm9w-gvfp) has no fixed release, and f9818bba swapped in
// `@bybrave/ip2`, a one-maintainer rewrite with no history, which then shipped in
// production. bittorrent-tracker's UDP server calls one function of it; a local
// copy of that function leaves no third-party code behind the name.
describe('ip', () => {
	it('resolves to the in-repo shim, not a registry package', () => {
		const entry = lock.packages['node_modules/ip'];
		expect(entry?.resolved).toBe('vendor/ip');
		expect(entry?.link).toBe(true);
		const fromTracker = createRequire(
			path.join(root, 'node_modules/bittorrent-tracker/index.js')
		);
		expect(fromTracker.resolve('ip')).toBe(path.join(root, 'vendor/ip/index.js'));
	});

	it('formats addresses the way parse-udp passes them', async () => {
		const ip = (await import(path.join(root, 'vendor/ip/index.js'))).default;
		// parse-udp passes the announce's optional IPv4 field as a uint32.
		expect(ip.toString(0x01020304)).toBe('1.2.3.4');
		expect(ip.toString(Buffer.from([192, 168, 0, 1]))).toBe('192.168.0.1');
		expect(ip.toString(Buffer.from('20010db8000000000000000000000001', 'hex'))).toBe(
			'2001:db8::1'
		);
	});

	// The deps stage installs from package*.json alone; a file: package missing there
	// fails `npm ci` and with it every deploy.
	it('is copied into the Docker install stage before npm ci', () => {
		const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf-8');
		const deps = dockerfile.slice(dockerfile.indexOf('AS deps'), dockerfile.indexOf('npm ci'));
		const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
		const local = Object.values<string>(pkg.dependencies)
			.filter((spec) => spec.startsWith('file:'))
			.map((spec) => spec.slice('file:'.length).split('/')[0]);
		expect(local).toContain('vendor');
		for (const dir of local) expect(deps).toMatch(new RegExp(`COPY ${dir} \\./${dir}`));
	});
});
