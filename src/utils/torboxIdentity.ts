import crypto from 'crypto';

const USER_ME_URL = 'https://api.torbox.app/v1/api/user/me';
const TIMEOUT_MS = 5000;

/**
 * A stable DMM id for the owner of a TorBox key, or null when TorBox does not
 * vouch for the key.
 *
 * The TorBox counterpart of `generateUserId`, which hashes a Real-Debrid
 * username. It exists for the request board: a fulfiller's own Real-Debrid
 * plays no part in a transfer, so someone with only TorBox has to be
 * identifiable without one. The account id is hashed with the same salt, so the
 * id never reveals the account, and prefixed so it can never equal a
 * Real-Debrid-derived id.
 *
 * Unlike `isFreeTorBoxPlan`, anything short of a definite answer is null: this
 * decides who is acting, and an unverified key must not act at all.
 */
export async function torboxUserId(apiKey: string): Promise<string | null> {
	const salt = process.env.DMMCAST_SALT;
	if (!salt) throw new Error('DMMCAST_SALT environment variable is not set');
	try {
		const res = await fetch(USER_ME_URL, {
			headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) return null;
		const body = await res.json().catch(() => null);
		const id = body?.success === true ? body?.data?.id : null;
		if (typeof id !== 'number' && typeof id !== 'string') return null;
		const hmac = crypto.createHmac('sha256', salt).update(`torbox:${id}`).digest('base64url');
		return `tb:${hmac.slice(0, 12)}`;
	} catch {
		return null;
	}
}
