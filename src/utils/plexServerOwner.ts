/**
 * Who is asking for a rex-direct name: the Plex account a rex server is claimed
 * on (`src/pages/api/rex-direct/register`). rex sends its claim's server token,
 * and plex.tv's device list for that token says whether the account owns a server
 * with that machineIdentifier.
 *
 * Measured 2026-10-19 with fun-rex's server token: `/api/v2/resources` answers
 * every device on the account, servers and players alike (a `provides:
 * "controller"` row among them), so ownership is an entry with this
 * `clientIdentifier`, `owned: true` and `server` in `provides`. A bad token is 401.
 */
import { RedisWithMemory } from '@/services/torznab/redisWithMemory';
import { createHash } from 'node:crypto';

const PLEX = 'https://plex.tv/api/v2';

/**
 * Every call to plex.tv with a server's token makes plex.tv take DMM's address for
 * the server's own and drop it from the account's Plex apps until the server
 * announces again (rex `docs/findings.md`, "The provider's address, taken for the
 * server's", 2026-11-16). So an owner plex.tv confirmed is kept for a day, counted
 * from that answer and never extended, per server and only for the exact token
 * that was checked: a new token is asked about at once. rex registers every 6 h,
 * on each start and a minute later, and every minute while its certificate is
 * issued; all of those are answered from here. Refusals are never kept.
 */
export const OWNER_TTL_SECONDS = 24 * 3600;
let store: RedisWithMemory | undefined;
const ownerStore = () => (store ??= new RedisWithMemory(process.env.REDIS_URL, 1000));
export const clearOwnerCache = () => (store = undefined);

export interface PlexResource {
	clientIdentifier?: string;
	provides?: string;
	owned?: boolean;
}

export function ownsServer(resources: unknown, machineIdentifier: string): boolean {
	return (
		Array.isArray(resources) &&
		resources.some(
			(resource: PlexResource) =>
				resource?.clientIdentifier === machineIdentifier &&
				resource.owned === true &&
				(resource.provides ?? '').split(',').includes('server')
		)
	);
}

export type OwnerCheck = { accountId: string } | { status: number; error: string };

export async function plexServerOwner(
	token: string,
	machineIdentifier: string
): Promise<OwnerCheck> {
	const key = `rexdirect:owner:v1:${machineIdentifier}`;
	const tokenHash = createHash('sha256').update(token).digest('hex');
	const [kept] = await ownerStore().get([key]);
	const [keptHash, keptAccount] = kept?.split(' ') ?? [];
	if (keptHash === tokenHash && keptAccount) return { accountId: keptAccount };

	const owner = await askPlexServerOwner(token, machineIdentifier);
	if ('accountId' in owner) {
		await ownerStore().set([[key, `${tokenHash} ${owner.accountId}`, OWNER_TTL_SECONDS]]);
	}
	return owner;
}

async function askPlexServerOwner(token: string, machineIdentifier: string): Promise<OwnerCheck> {
	const headers = {
		Accept: 'application/json',
		'X-Plex-Token': token,
		'X-Plex-Client-Identifier': machineIdentifier,
		'X-Plex-Product': 'Debrid Media Manager',
	};
	const resources = await fetch(`${PLEX}/resources`, { headers });
	if (resources.status === 401) return { status: 401, error: 'Plex refused the token' };
	if (!resources.ok) return { status: 502, error: `plex.tv answered ${resources.status}` };
	if (!ownsServer(await resources.json(), machineIdentifier)) {
		return { status: 403, error: 'The Plex account does not own this server' };
	}
	const user = await fetch(`${PLEX}/user`, { headers });
	const id = user.ok ? (await user.json())?.id : undefined;
	if (id === undefined || id === null) {
		return { status: 502, error: `plex.tv answered ${user.status} for the account` };
	}
	return { accountId: String(id) };
}
