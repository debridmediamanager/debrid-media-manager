import { createPublicKey, generateKeyPairSync, webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auto = vi.fn();
vi.mock('@geektr/acme-dns01', () => ({
	Client: vi.fn(function () {
		return { auto };
	}),
	directory: { zerossl: { production: 'https://acme.zerossl.com/v2/DV90' } },
	crypto: {
		createPrivateEcdsaKey: vi.fn(async () => Buffer.from('KEY')),
		createCsr: vi.fn(async () => [Buffer.from('KEY'), Buffer.from('CSR')]),
		readCertificateInfo: vi.fn(() => ({ notAfter: new Date('2027-01-17T23:59:59Z') })),
	},
}));
vi.mock('@/utils/rexDirectDns', () => ({
	createRexDirectTxt: vi.fn(async () => 'rec1'),
	deleteRexDirectRecord: vi.fn(async () => undefined),
}));

// What answers the authoritative lookup, per attempt.
let answers: string[][][] = [];
const setServers = vi.fn();
vi.mock('dns', () => {
	const dns = {
		Resolver: vi.fn(function () {
			return {
				setServers,
				resolveTxt: (
					_name: string,
					callback: (error: Error | null, records: string[][]) => void
				) => {
					const next = answers.shift();
					next ? callback(null, next) : callback(new Error('ENOTFOUND'), []);
				},
			};
		}),
		promises: {
			resolveNs: vi.fn(async () => ['chan.ns.cloudflare.com']),
			resolve4: vi.fn(async () => ['173.245.58.82']),
		},
	};
	return { ...dns, default: dns };
});

describe('issueRexDirectCert', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
		const { privateKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1',
			privateKeyEncoding: { format: 'pem', type: 'sec1' },
			publicKeyEncoding: { format: 'pem', type: 'spki' },
		});
		process.env.REXDIRECT_ACME_ACCOUNT_KEY_B64 = Buffer.from(privateKey).toString('base64');
		process.env.REXDIRECT_ACME_EAB_KID = 'kid';
		process.env.REXDIRECT_ACME_EAB_HMAC = 'hmac';
		process.env.REXDIRECT_ACME_EMAIL = 'ops@example.com';
		auto.mockImplementation(async (options: any) => {
			await options.challengeCreateFn(
				{ identifier: { value: 'h1.rex-direct.debridmediamanager.com' } },
				{},
				'KA'
			);
			return 'CHAIN';
		});
	});

	// 2026-10-19: the recursive check asked the system resolver the moment the
	// TXT was created and failed; a recursive miss can also be cached for 30 min.
	it("skips the recursive resolver check and waits for the zone's own nameservers", async () => {
		answers = [[], [], [['KA']]];
		const { issueRexDirectCert } = await import('@/utils/rexDirectAcme');
		const issued = await issueRexDirectCert('h1.rex-direct.debridmediamanager.com');
		expect(auto.mock.calls[0][0]).toMatchObject({
			skipChallengeVerification: true,
		});
		expect(setServers).toHaveBeenCalledWith(['173.245.58.82']);
		expect(answers).toEqual([]);
		expect(issued).toMatchObject({ certificate: 'CHAIN', privateKey: 'KEY' });
	});

	// 2026-10-19: a real 32-hex name is 66 characters, over a CommonName's 64, and
	// ZeroSSL refused the order at finalize ("The CSR and order identifiers differ").
	it('puts a name longer than 64 characters in the SAN only', async () => {
		answers = [[['KA']]];
		// Load after this test's environment and hoisted factory state are initialized.
		const acme = await import('@geektr/acme-dns01');
		const { issueRexDirectCert } = await import('@/utils/rexDirectAcme');
		const long = `${'a'.repeat(32)}.rex-direct.debridmediamanager.com`;
		await issueRexDirectCert(long);
		expect(vi.mocked(acme.crypto.createCsr).mock.calls.at(-1)?.[0]).toEqual({
			altNames: [long],
		});
	});

	it('preserves a traditional PEM account key identity in the Web Crypto client', async () => {
		answers = [[['KA']]];
		// Load after this test's generated account and factory state are initialized.
		const acme = await import('@geektr/acme-dns01');
		const { issueRexDirectCert } = await import('@/utils/rexDirectAcme');
		await issueRexDirectCert('h1.rex-direct.debridmediamanager.com');
		const passed = vi.mocked(acme.Client).mock.calls.at(-1)![0].accountKey;
		const der = Buffer.from(
			passed
				.toString()
				.replace(/-----[^-]+-----/g, '')
				.replace(/\s/g, ''),
			'base64'
		);
		await expect(
			webcrypto.subtle.importKey(
				'pkcs8',
				Uint8Array.from(der).buffer,
				{ name: 'ECDSA', namedCurve: 'P-256' },
				false,
				['sign']
			)
		).resolves.toBeDefined();
		const configured = Buffer.from(process.env.REXDIRECT_ACME_ACCOUNT_KEY_B64!, 'base64');
		expect(createPublicKey(passed).export({ format: 'der', type: 'spki' })).toEqual(
			createPublicKey(configured).export({ format: 'der', type: 'spki' })
		);
	});
});
