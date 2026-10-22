import * as acme from '@geektr/acme-dns01';
import { Resolver, promises as dns } from 'dns';
import { createPrivateKey } from 'node:crypto';
import { createRexDirectTxt, deleteRexDirectRecord } from './rexDirectDns';

/**
 * A certificate for one rex server's own `<hash>.rex-direct…` name, from ZeroSSL
 * over ACME DNS-01 (`src/pages/api/rex-direct/register`). Each server gets its own
 * key, so no server holds one that works for another's name: a shared wildcard key
 * handed to every claimed server would be public in all but name. ZeroSSL rather
 * than Let's Encrypt because LE allows about 50 new certificates a week per
 * registered domain, which would queue servers after a launch.
 *
 * Takes tens of seconds to minutes, so the register endpoint runs it in the
 * background and answers 202 until it is stored.
 */
function config() {
	const accountKey = process.env.REXDIRECT_ACME_ACCOUNT_KEY_B64;
	const kid = process.env.REXDIRECT_ACME_EAB_KID;
	const hmacKey = process.env.REXDIRECT_ACME_EAB_HMAC;
	const email = process.env.REXDIRECT_ACME_EMAIL;
	if (!accountKey || !kid || !hmacKey || !email) {
		throw new Error(
			'rex-direct: REXDIRECT_ACME_ACCOUNT_KEY_B64, REXDIRECT_ACME_EAB_KID, REXDIRECT_ACME_EAB_HMAC and REXDIRECT_ACME_EMAIL must be set'
		);
	}
	return {
		accountKey: createPrivateKey(Buffer.from(accountKey, 'base64')).export({
			format: 'pem',
			type: 'pkcs8',
		}),
		externalAccountBinding: { kid, hmacKey },
		email,
		directoryUrl: process.env.REXDIRECT_ACME_DIRECTORY || acme.directory.zerossl.production,
	};
}

/**
 * Wait until the zone's own nameservers answer the challenge TXT. The recursive
 * check asked the system resolver at once and failed on a record Cloudflare had
 * just accepted (2026-10-19); a recursive resolver can also cache that miss
 * (the zone's negative TTL is 30 min), so ask the authoritative servers directly.
 */
async function waitForTxt(name: string, value: string): Promise<void> {
	const zone = name.split('.').slice(-2).join('.');
	const servers = (
		await Promise.all((await dns.resolveNs(zone)).map((ns) => dns.resolve4(ns).catch(() => [])))
	).flat();
	const resolver = new Resolver();
	resolver.setServers(servers);
	for (let attempt = 0; attempt < 60; attempt++) {
		const found = await new Promise<string[][]>((resolve) =>
			resolver.resolveTxt(name, (error, records) => resolve(error ? [] : records))
		);
		if (found.some((parts) => parts.join('') === value)) return;
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error(`rex-direct: ${name} never appeared on the zone's nameservers`);
}

export interface IssuedCert {
	certificate: string;
	privateKey: string;
	expiresAt: Date;
}

export async function issueRexDirectCert(hostname: string): Promise<IssuedCert> {
	const { accountKey, externalAccountBinding, email, directoryUrl } = config();
	const client = new acme.Client({ directoryUrl, accountKey, externalAccountBinding });
	const privateKey = await acme.crypto.createPrivateEcdsaKey();
	// The name goes in the SAN only: a CommonName holds at most 64 characters, and a
	// 32-hex `<hash>.rex-direct.debridmediamanager.com` is 66, which ZeroSSL refused at
	// finalize as "The CSR and order identifiers differ" (2026-10-19).
	const [, csr] = await acme.crypto.createCsr(
		hostname.length <= 64
			? { commonName: hostname, altNames: [hostname] }
			: { altNames: [hostname] },
		privateKey
	);
	const records = new Map<string, string>();
	const certificate = await client.auto({
		csr: Buffer.from(csr),
		email,
		termsOfServiceAgreed: true,
		skipChallengeVerification: true,
		challengeCreateFn: async (authz, _challenge, keyAuthorization) => {
			const name = authz.identifier.value;
			records.set(name, await createRexDirectTxt(name, keyAuthorization));
			await waitForTxt(`_acme-challenge.${name}`, keyAuthorization);
		},
		challengeRemoveFn: async (authz) => {
			const id = records.get(authz.identifier.value);
			if (id) await deleteRexDirectRecord(id).catch(() => undefined);
		},
	});
	return {
		certificate,
		privateKey: Buffer.from(privateKey).toString('utf8'),
		expiresAt: acme.crypto.readCertificateInfo(certificate).notAfter,
	};
}
