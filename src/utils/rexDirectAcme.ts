import * as acme from 'acme-client';
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
		accountKey: Buffer.from(accountKey, 'base64'),
		externalAccountBinding: { kid, hmacKey },
		email,
		directoryUrl: process.env.REXDIRECT_ACME_DIRECTORY || acme.directory.zerossl.production,
	};
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
	const [, csr] = await acme.crypto.createCsr({ commonName: hostname }, privateKey);
	const records = new Map<string, string>();
	const certificate = await client.auto({
		csr,
		email,
		termsOfServiceAgreed: true,
		challengePriority: ['dns-01'],
		challengeCreateFn: async (authz, _challenge, keyAuthorization) => {
			records.set(
				authz.identifier.value,
				await createRexDirectTxt(authz.identifier.value, keyAuthorization)
			);
		},
		challengeRemoveFn: async (authz) => {
			const id = records.get(authz.identifier.value);
			if (id) await deleteRexDirectRecord(id).catch(() => undefined);
		},
	});
	return {
		certificate,
		privateKey: privateKey.toString(),
		expiresAt: acme.crypto.readCertificateInfo(certificate).notAfter,
	};
}
