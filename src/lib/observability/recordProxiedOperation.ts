import { recordRdOperationEvent, resolveRealDebridOperation } from './rdOperationalStats';
import { recordTorBoxOperationEvent, resolveTorBoxOperation } from './torboxOperationalStats';

const RD_HOSTS = ['app.real-debrid.com', 'api.real-debrid.com'];
const TORBOX_HOST = 'api.torbox.app';

/**
 * Records what a proxied debrid call returned, keyed on the upstream host:
 * whichever service the call was actually for. This is what the
 * `/is-*-down-or-just-me` pages count.
 *
 * Two proxies feed this. Real-Debrid browser traffic runs through our own
 * anticors (`src/pages/api/anticors.ts`) and records in-process. TorBox runs
 * through the Cloudflare Worker instead - it must, because `*.cors` is a single
 * host and pooling every user's TorBox calls behind one IP got 20% of them
 * 429'd - so the Worker reports here over HTTP instead.
 *
 * Takes a pathname, never a full URL: `requestdl` puts the raw API key in
 * `?token=`, and a query string reaching this far would land in the logs.
 */
export function recordProxiedOperation(
	host: string,
	method: string | undefined,
	pathname: string,
	status: number
): void {
	if (RD_HOSTS.includes(host)) {
		const operation = resolveRealDebridOperation(method, pathname);
		if (operation) {
			recordRdOperationEvent(operation, status);
		}
		return;
	}

	if (host === TORBOX_HOST) {
		const operation = resolveTorBoxOperation(method, pathname);
		if (operation) {
			recordTorBoxOperationEvent(operation, status);
		}
	}
}
