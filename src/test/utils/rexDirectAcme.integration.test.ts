// @vitest-environment node
/**
 * Real DNS-01 issuance, not an ACME response fixture. Needs Linux, local Docker
 * (host networking/socket), Node >=24.5 and openssl. Skips without those runtime
 * prerequisites, like the database integration tests. Run in a Linux Node Docker
 * runner with --network=host -v /var/run/docker.sock:/var/run/docker.sock and
 * TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1. Ports 19449-19452 must be free.
 *
 * Only DNS control/topology is adapted: Cloudflare writes go to challtestsrv;
 * the utility's authoritative resolver uses its real UDP DNS server instead of
 * public NS discovery. Both the actual utility and Pebble query real TXT data.
 * No production ACME/DNS endpoints, keys, or TLS verification bypasses are used.
 */
import { issueRexDirectCert } from '@/utils/rexDirectAcme';
import * as acme from '@geektr/acme-dns01';
import { execFileSync } from 'node:child_process';
import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
	X509Certificate,
} from 'node:crypto';
import type * as NodeDns from 'node:dns';
import { Resolver as PromiseResolver } from 'node:dns/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as tls from 'node:tls';
import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer, getContainerRuntimeClient, Wait } from 'testcontainers';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
	dnsPort: 19451,
	management: 'http://127.0.0.1:19452',
	created: [] as string[],
	removed: [] as string[],
}));

async function dnsControl(endpoint: string, body: Record<string, string>) {
	const response = await fetch(`${fixture.management}/${endpoint}`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error(`challtestsrv ${endpoint}: HTTP ${response.status}`);
	return response;
}

vi.mock('@/utils/rexDirectDns', () => ({
	createRexDirectTxt: async (hostname: string, value: string) => {
		const record = `_acme-challenge.${hostname}.`;
		await dnsControl('set-txt', { host: record, value });
		fixture.created.push(record);
		return record;
	},
	deleteRexDirectRecord: async (record: string) => {
		await dnsControl('clear-txt', { host: record });
		fixture.removed.push(record);
	},
}));

vi.mock('dns', async () => {
	const actual = await vi.importActual<typeof NodeDns>('dns');
	return {
		...actual,
		// The isolated DNS server has no public delegation. Adapt topology only;
		// resolveTxt remains Node's real resolver and reaches challtestsrv over UDP.
		promises: {
			...actual.promises,
			resolveNs: async () => ['ns.acme.test'],
			resolve4: async () => ['127.0.0.1'],
		},
		Resolver: class extends actual.Resolver {
			constructor() {
				super();
				const setServers = this.setServers.bind(this);
				this.setServers = (servers: readonly string[]) => {
					expect(servers).toEqual(['127.0.0.1']);
					setServers([`127.0.0.1:${fixture.dnsPort}`]);
				};
			}
		},
	};
});

let runtimeAvailable = false;
if (process.platform === 'linux' && typeof tls.setDefaultCACertificates === 'function') {
	try {
		execFileSync('openssl', ['version'], { stdio: 'ignore' });
		await getContainerRuntimeClient();
		runtimeAvailable = true;
	} catch {
		// Docker and openssl are optional integration-test prerequisites only.
	}
}

const ACME_PORT = 19449;
const ADMIN_PORT = 19450;
const HOSTNAME = `${'a'.repeat(32)}.rex-direct.debridmediamanager.com`;
const DIRECTORY = `https://localhost:${ACME_PORT}/dir`;
const ADMIN = `https://localhost:${ADMIN_PORT}`;
const PEBBLE_IMAGE = 'ghcr.io/letsencrypt/pebble:2.10.1';
const DNS_IMAGE = 'ghcr.io/letsencrypt/pebble-challtestsrv:2.10.1';

async function requireFreeTcpPort(port: number) {
	const listener = createTcpServer();
	const listening = Promise.withResolvers<void>();
	listener.once('error', listening.reject);
	listener.listen(port, '127.0.0.1', listening.resolve);
	await listening.promise;
	const closed = Promise.withResolvers<void>();
	listener.close((error) => (error ? closed.reject(error) : closed.resolve()));
	await closed.promise;
}

/** openssl checks the CSR independently of the replacement client's parser. */
function openssl(args: string[]) {
	return execFileSync('openssl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe.skipIf(!runtimeAvailable)('RexDirect real Pebble DNS-01 issuance (Integration)', () => {
	let scratch: string | undefined;
	let pebble: StartedTestContainer | undefined;
	let challengeDns: StartedTestContainer | undefined;
	let server: tls.Server | undefined;
	let originalCas: string[] | undefined;

	afterAll(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		if (server?.listening) {
			const closed = Promise.withResolvers<void>();
			server.close(() => closed.resolve());
			await closed.promise;
		}
		try {
			await pebble?.stop();
		} finally {
			try {
				await challengeDns?.stop();
			} finally {
				if (originalCas) tls.setDefaultCACertificates(originalCas);
				if (scratch) await rm(scratch, { recursive: true, force: true });
			}
		}
	}, 60_000);

	it('requires EAB, validates real DNS, and returns a usable SAN-only EC key/fullchain', async () => {
		for (const port of [ACME_PORT, ADMIN_PORT, fixture.dnsPort, 19452])
			await requireFreeTcpPort(port);
		scratch = await mkdtemp(path.join(tmpdir(), 'dmm-acme-'));
		const file = (name: string) => path.join(scratch!, name);
		openssl([
			'req',
			'-x509',
			'-newkey',
			'ec',
			'-pkeyopt',
			'ec_paramgen_curve:P-256',
			'-nodes',
			'-keyout',
			file('ca.key'),
			'-out',
			file('ca.pem'),
			'-days',
			'2',
			'-subj',
			'/CN=DMM isolated ACME transport CA',
			'-addext',
			'basicConstraints=critical,CA:TRUE',
		]);
		openssl([
			'req',
			'-new',
			'-newkey',
			'ec',
			'-pkeyopt',
			'ec_paramgen_curve:P-256',
			'-nodes',
			'-keyout',
			file('server.key'),
			'-out',
			file('server.csr'),
			'-subj',
			'/CN=localhost',
		]);
		await writeFile(
			file('server.ext'),
			'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n'
		);
		openssl([
			'x509',
			'-req',
			'-in',
			file('server.csr'),
			'-CA',
			file('ca.pem'),
			'-CAkey',
			file('ca.key'),
			'-CAcreateserial',
			'-out',
			file('server.pem'),
			'-days',
			'2',
			'-extfile',
			file('server.ext'),
		]);
		const transportCa = await readFile(file('ca.pem'), 'utf8');
		originalCas = tls.getCACertificates('default');
		tls.setDefaultCACertificates([...originalCas, transportCa]);
		const kid = `dmm-test-${randomBytes(8).toString('hex')}`;
		const hmac = randomBytes(32).toString('base64url');
		const config = {
			pebble: {
				listenAddress: `127.0.0.1:${ACME_PORT}`,
				managementListenAddress: `127.0.0.1:${ADMIN_PORT}`,
				certificate: '/tmp/dmm-server.pem',
				privateKey: '/tmp/dmm-server.key',
				externalAccountBindingRequired: true,
				externalAccountMACKeys: { [kid]: hmac },
				keyAlgorithm: 'ecdsa',
				retryAfter: { authz: 1, order: 1 },
			},
		};
		challengeDns = await new GenericContainer(DNS_IMAGE)
			.withNetworkMode('host')
			.withResourcesQuota({ cpu: 0.1, memory: 0.125 })
			.withCommand([
				'-dnsserver',
				`127.0.0.1:${fixture.dnsPort}`,
				'-management',
				'127.0.0.1:19452',
				'-http01',
				'',
				'-https01',
				'',
				'-tlsalpn01',
				'',
				'-doh',
				'',
			])
			.withWaitStrategy(Wait.forLogMessage(/Starting management server/))
			.start();
		pebble = await new GenericContainer(PEBBLE_IMAGE)
			.withNetworkMode('host')
			.withResourcesQuota({ cpu: 0.2, memory: 0.1875 })
			.withCopyContentToContainer([
				{ content: JSON.stringify(config), target: '/tmp/dmm-pebble.json' },
				{ content: await readFile(file('server.pem')), target: '/tmp/dmm-server.pem' },
				{ content: await readFile(file('server.key')), target: '/tmp/dmm-server.key' },
			])
			// Validation stays enabled; only random delays/nonce rejection are disabled.
			.withEnvironment({
				PEBBLE_VA_NOSLEEP: '1',
				PEBBLE_WFE_NONCEREJECT: '0',
				PEBBLE_AUTHZREUSE: '0',
			})
			.withCommand([
				'-config',
				'/tmp/dmm-pebble.json',
				'-dnsserver',
				`127.0.0.1:${fixture.dnsPort}`,
				'-strict=false',
			])
			.withWaitStrategy(Wait.forLogMessage(/ACME directory available/))
			.start();
		const directory = await (await fetch(DIRECTORY)).json();
		expect(directory.meta.externalAccountRequired).toBe(true);

		vi.stubEnv('REXDIRECT_ACME_DIRECTORY', DIRECTORY);
		const accountKey = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1',
			privateKeyEncoding: { format: 'pem', type: 'sec1' },
			publicKeyEncoding: { format: 'pem', type: 'spki' },
		}).privateKey;
		vi.stubEnv('REXDIRECT_ACME_ACCOUNT_KEY_B64', Buffer.from(accountKey).toString('base64'));
		vi.stubEnv('REXDIRECT_ACME_EAB_KID', kid);
		vi.stubEnv('REXDIRECT_ACME_EAB_HMAC', randomBytes(32).toString('base64url'));
		vi.stubEnv('REXDIRECT_ACME_EMAIL', 'dmm-acme@example.test');
		// The real CA must reject incorrect EAB before any DNS/order work.
		await expect(issueRexDirectCert(HOSTNAME)).rejects.toThrow(/external|binding|hmac|MAC/i);
		expect(fixture.created).toEqual([]);
		vi.stubEnv('REXDIRECT_ACME_EAB_HMAC', hmac);

		const events: string[] = [];
		let issuingClient: acme.Client | undefined;
		let csr: Buffer | string | undefined;
		const realAuto = acme.Client.prototype.auto;
		vi.spyOn(acme.Client.prototype, 'auto').mockImplementation(function (
			this: acme.Client,
			options
		) {
			issuingClient = this;
			csr = options.csr;
			const operation = realAuto.call(this, options);
			for (const event of [
				'account:register',
				'order:create',
				'order:created',
				'challenge:create',
				'challenge:verify-skip',
				'challenge:complete',
				'challenge:remove',
				'order:finalize',
			]) {
				operation.addEventListener(event, () => events.push(event));
			}
			return operation;
		});
		const createOrder = vi.spyOn(acme.Client.prototype, 'createOrder');
		const createAccount = vi.spyOn(acme.Client.prototype, 'createAccount');
		// The client holds the ZeroSSL account key and EAB HMAC, and comes from a
		// one-maintainer package: it may talk to the CA it was given and nothing else.
		const realFetch = globalThis.fetch;
		const contacted = new Set<string>();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
			contacted.add(new URL(input instanceof Request ? input.url : String(input)).host);
			return realFetch(input, init);
		});
		const issued = await issueRexDirectCert(HOSTNAME).finally(() => fetchSpy.mockRestore());
		// challtestsrv's management API stands in for DMM's Cloudflare writes.
		contacted.delete(new URL(fixture.management).host);
		expect([...contacted]).toEqual([new URL(DIRECTORY).host]);
		expect(HOSTNAME).toHaveLength(66);
		expect(Object.keys(issued).sort()).toEqual(['certificate', 'expiresAt', 'privateKey']);
		expect(issued.privateKey).toMatch(/^-----BEGIN (?:EC )?PRIVATE KEY-----/);
		const key = createPrivateKey(issued.privateKey);
		expect(key.asymmetricKeyType).toBe('ec');
		const chain = acme.crypto
			.splitPemChain(issued.certificate)
			.map((pem) => new X509Certificate(pem));
		expect(chain.length).toBeGreaterThanOrEqual(2);
		const leaf = chain[0];
		expect(leaf.subject ?? '').not.toMatch(/CN=/);
		expect(leaf.subjectAltName).toBe(`DNS:${HOSTNAME}`);
		expect(leaf.checkHost(HOSTNAME)).toBe(HOSTNAME);
		expect(leaf.checkPrivateKey(key)).toBe(true);
		expect(leaf.publicKey.export({ type: 'spki', format: 'pem' })).toBe(
			createPublicKey(key).export({ type: 'spki', format: 'pem' })
		);
		expect(issued.expiresAt).toBeInstanceOf(Date);
		expect(issued.expiresAt.getTime()).toBe(Date.parse(leaf.validTo));
		expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
		expect(Date.parse(leaf.validFrom)).toBeLessThanOrEqual(Date.now());
		const issuanceRoot = await (await fetch(`${ADMIN}/roots/0`)).text();
		const root = new X509Certificate(issuanceRoot);
		for (let index = 0; index < chain.length - 1; index++) {
			expect(chain[index].verify(chain[index + 1].publicKey)).toBe(true);
		}
		expect(chain.at(-1)!.verify(root.publicKey)).toBe(true);
		await writeFile(file('issued.csr'), csr!);
		const csrText = openssl(['req', '-in', file('issued.csr'), '-noout', '-verify', '-text']);
		expect(csrText).toContain(`DNS:${HOSTNAME}`);
		expect(csrText).not.toMatch(/Subject:.*CN\s*=/);
		await writeFile(file('leaf.pem'), leaf.toString());
		await writeFile(
			file('intermediate.pem'),
			chain
				.slice(1)
				.map((cert) => cert.toString())
				.join('\n')
		);
		await writeFile(file('issuance-root.pem'), issuanceRoot);
		expect(
			openssl([
				'verify',
				'-CAfile',
				file('issuance-root.pem'),
				'-untrusted',
				file('intermediate.pem'),
				'-verify_hostname',
				HOSTNAME,
				file('leaf.pem'),
			])
		).toContain(': OK');

		const account = await createAccount.mock.results[0].value;
		expect(account.status).toBe('valid');
		expect(account.contact).toEqual(['mailto:dmm-acme@example.test']);
		expect(issuingClient!.getAccountUrl()).toMatch(/^https:\/\/localhost:19449\//);
		const configuredAccountJwk = createPublicKey(accountKey).export({ format: 'jwk' });
		expect(await issuingClient!.api.http.getJwk()).toMatchObject(configuredAccountJwk);
		const initialOrder = await createOrder.mock.results[0].value;
		const finalOrder = await issuingClient!.getOrder(initialOrder);
		expect(finalOrder.status).toBe('valid');
		expect(finalOrder.identifiers).toEqual([{ type: 'dns', value: HOSTNAME }]);
		const authorizations = await issuingClient!.getAuthorizations(finalOrder);
		expect(authorizations).toHaveLength(1);
		expect(authorizations[0].status).toBe('valid');
		expect(authorizations[0].challenges).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'dns-01', status: 'valid' })])
		);
		for (const event of [
			'account:register',
			'order:create',
			'order:created',
			'challenge:create',
			'challenge:verify-skip',
			'challenge:complete',
			'challenge:remove',
			'order:finalize',
		]) {
			expect(events).toContain(event);
		}
		expect(fixture.created).toEqual([`_acme-challenge.${HOSTNAME}.`]);
		expect(fixture.removed).toEqual(fixture.created);
		const dnsHistory = await (
			await dnsControl('dns-request-history', { host: `_acme-challenge.${HOSTNAME}` })
		).json();
		expect(
			dnsHistory.filter(
				(entry: { Question: { Qtype: number } }) => entry.Question.Qtype === 16
			).length
		).toBeGreaterThanOrEqual(2);
		const resolver = new PromiseResolver();
		resolver.setServers([`127.0.0.1:${fixture.dnsPort}`]);
		await expect(resolver.resolveTxt(`_acme-challenge.${HOSTNAME}`)).rejects.toMatchObject({
			code: 'ENODATA',
		});

		server = tls.createServer({ key: issued.privateKey, cert: issued.certificate }, (socket) =>
			socket.end('real-acme-tls-ok')
		);
		const listening = Promise.withResolvers<void>();
		server.listen(0, '127.0.0.1', listening.resolve);
		await listening.promise;
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing TLS listener address');
		const received = Promise.withResolvers<string>();
		const socket = tls.connect({
			host: '127.0.0.1',
			port: address.port,
			servername: HOSTNAME,
			ca: issuanceRoot,
		});
		let body = '';
		socket.on('secureConnect', () => {
			try {
				expect(socket.authorized).toBe(true);
			} catch (error) {
				socket.destroy();
				received.reject(error);
			}
		});
		socket.on('data', (data) => {
			body += data.toString();
		});
		socket.on('error', received.reject);
		socket.on('end', () => received.resolve(body));
		expect(await received.promise).toBe('real-acme-tls-ok');
	}, 180_000);
});
