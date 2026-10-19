/**
 * Point `<hash>.rex-direct.debridmediamanager.com` at a rex server's own IP
 * (`src/pages/api/rex-direct/register`).
 *
 * The IP is always the request's source address, never a value the caller sends,
 * so the service cannot be used to aim a name under our domain at someone else's
 * server. The Cloudflare token is zone-scoped to DNS edit on this one zone and
 * lives only in the server env.
 *
 * The record is looked up through the Cloudflare API, never a DNS resolver: a
 * resolver query for a name that does not exist yet is negatively cached by the
 * authoritative servers for 30 minutes (the zone's SOA minimum), which would then
 * hide the record we just created.
 */
const CF = 'https://api.cloudflare.com/client/v4';

function config() {
	const token = process.env.REXDIRECT_CF_TOKEN;
	const zone = process.env.REXDIRECT_CF_ZONE;
	const base = process.env.REXDIRECT_BASE || 'rex-direct.debridmediamanager.com';
	if (!token || !zone) {
		throw new Error('rex-direct: REXDIRECT_CF_TOKEN and REXDIRECT_CF_ZONE must be set');
	}
	return { token, zone, base };
}

export function rexDirectHostname(hash: string): string {
	return `${hash}.${config().base}`;
}

async function cf(path: string, init: RequestInit, token: string): Promise<any> {
	const res = await fetch(`${CF}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...(init.headers || {}),
		},
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body?.success === false) {
		const detail = Array.isArray(body?.errors) ? JSON.stringify(body.errors) : res.status;
		throw new Error(`rex-direct: Cloudflare ${path} failed: ${detail}`);
	}
	return body;
}

/**
 * Ensure `<hash>.rex-direct…` is a DNS-only A record for `ip`. Returns the
 * hostname. Grey-cloud (not proxied) on purpose: proxying Plex streaming through
 * Cloudflare violates their free TOS, and TLS terminates at the server.
 */
export async function upsertRexDirectRecord(hash: string, ip: string): Promise<string> {
	const { token, zone, base } = config();
	const name = `${hash}.${base}`;
	const list = await cf(
		`/zones/${zone}/dns_records?type=A&name=${encodeURIComponent(name)}`,
		{ method: 'GET' },
		token
	);
	const record = Array.isArray(list.result) ? list.result[0] : undefined;
	const payload = JSON.stringify({ type: 'A', name, content: ip, ttl: 120, proxied: false });
	if (record) {
		if (record.content !== ip) {
			await cf(
				`/zones/${zone}/dns_records/${record.id}`,
				{ method: 'PUT', body: payload },
				token
			);
		}
	} else {
		await cf(`/zones/${zone}/dns_records`, { method: 'POST', body: payload }, token);
	}
	return name;
}

/**
 * The ACME DNS-01 challenge record for a server's own certificate
 * (`src/utils/rexDirectAcme.ts`): a TXT at `_acme-challenge.<name>`. Returns the
 * record id so the challenge can be cleaned up once validated.
 */
export async function createRexDirectTxt(name: string, content: string): Promise<string> {
	const { token, zone } = config();
	const body = await cf(
		`/zones/${zone}/dns_records`,
		{
			method: 'POST',
			body: JSON.stringify({
				type: 'TXT',
				name: `_acme-challenge.${name}`,
				content,
				ttl: 60,
			}),
		},
		token
	);
	return body.result.id;
}

export async function deleteRexDirectRecord(id: string): Promise<void> {
	const { token, zone } = config();
	await cf(`/zones/${zone}/dns_records/${id}`, { method: 'DELETE' }, token);
}
