import { getAllDebridUser } from '@/services/allDebrid';
import { getDebridLinkAccountInfo } from '@/services/debridLink';
import { getOffcloudAccountInfo } from '@/services/offcloud';
import { getPremiumizeAccountInfo } from '@/services/premiumize';
import { getCurrentUser } from '@/services/realDebrid';
import { TAGGED } from '@/services/reporterId';
import { torboxUserId } from '@/utils/torboxIdentity';
import { createHmac } from 'crypto';

/**
 * The reporter id for a debrid credential, or null when its service does not
 * vouch for it.
 *
 * Two reporters hide a result, and the id used to be whatever the client sent,
 * so one person could hide anything by sending two made-up keys. Each service
 * now names the account behind the key, and the id is a salted digest of that
 * account, so the `Report` table no longer holds anyone's key either.
 *
 * `reporterIdFor` sends Real-Debrid, AllDebrid and TorBox keys untagged; their
 * shapes tell them apart (on 2026-10-18 every stored RD key was 52 upper-case
 * characters and every TorBox key a UUID).
 */
export async function verifiedReporterId(credential: string): Promise<string | null> {
	const salt = process.env.DMMCAST_SALT;
	if (!salt) throw new Error('DMMCAST_SALT environment variable is not set');
	const id = (service: string, account: unknown) =>
		typeof account === 'number' || (typeof account === 'string' && account !== '')
			? `${service}:${createHmac('sha256', salt).update(`${service}:${account}`).digest('base64url').slice(0, 16)}`
			: null;
	const [, tag, key] = TAGGED.exec(credential) ?? [];
	try {
		if (tag === 'pm') return id('pm', (await getPremiumizeAccountInfo(key)).customer_id);
		if (tag === 'oc') return id('oc', (await getOffcloudAccountInfo(key)).user_id);
		if (tag === 'dl') return id('dl', (await getDebridLinkAccountInfo(key)).username);
		if (tag) return null;
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credential)) {
			return await torboxUserId(credential);
		}
		if (/^[A-Z0-9]{52}$/.test(credential))
			return id('rd', (await getCurrentUser(credential)).id);
		return id('ad', (await getAllDebridUser(credential)).username);
	} catch {
		return null;
	}
}
