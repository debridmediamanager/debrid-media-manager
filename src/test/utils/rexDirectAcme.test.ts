import { beforeEach, describe, expect, it, vi } from 'vitest';

const auto = vi.fn();
vi.mock('acme-client', () => ({
	Client: vi.fn(() => ({ auto })),
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
		Resolver: vi.fn(() => ({
			setServers,
			resolveTxt: (
				_name: string,
				callback: (error: Error | null, records: string[][]) => void
			) => {
				const next = answers.shift();
				next ? callback(null, next) : callback(new Error('ENOTFOUND'), []);
			},
		})),
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
		process.env.REXDIRECT_ACME_ACCOUNT_KEY_B64 = Buffer.from('ACCOUNT').toString('base64');
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

	// 2026-10-19: acme-client's own check asked the system resolver the moment the
	// TXT was created and failed; a recursive miss can also be cached for 30 min.
	it("skips acme-client's resolver check and waits for the zone's own nameservers", async () => {
		answers = [[], [], [['KA']]];
		const { issueRexDirectCert } = await import('@/utils/rexDirectAcme');
		const issued = await issueRexDirectCert('h1.rex-direct.debridmediamanager.com');
		expect(auto.mock.calls[0][0]).toMatchObject({
			skipChallengeVerification: true,
			challengePriority: ['dns-01'],
		});
		expect(setServers).toHaveBeenCalledWith(['173.245.58.82']);
		expect(answers).toEqual([]);
		expect(issued).toMatchObject({ certificate: 'CHAIN', privateKey: 'KEY' });
	});

	// 2026-10-19: a real 32-hex name is 66 characters, over a CommonName's 64, and
	// ZeroSSL refused the order at finalize ("The CSR and order identifiers differ").
	it('puts a name longer than 64 characters in the SAN only', async () => {
		answers = [[['KA']]];
		const acme = await import('acme-client');
		const { issueRexDirectCert } = await import('@/utils/rexDirectAcme');
		const long = `${'a'.repeat(32)}.rex-direct.debridmediamanager.com`;
		await issueRexDirectCert(long);
		expect(vi.mocked(acme.crypto.createCsr).mock.calls.at(-1)?.[0]).toEqual({
			altNames: [long],
		});
	});
});
