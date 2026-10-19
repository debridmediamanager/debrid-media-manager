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
const PLEX = 'https://plex.tv/api/v2';

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
