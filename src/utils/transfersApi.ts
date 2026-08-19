import type { TransferRow, TransfersResponse } from './transfers';

/**
 * Client side of the one endpoint that lists a user's transfers.
 *
 * The Transfers page used to build its list from two `localStorage` keys and
 * then issue one status request per tracked job, every five seconds. That made
 * transfers invisible on any other device and lost them with the browser's site
 * data. Now the account is the key, the server does the fan-out, and this is the
 * single request the page makes.
 */

/**
 * The RD key travels as a **header**, never a query param.
 *
 * nginx in front of DMM logs the request line, and this endpoint is polled every
 * five seconds per open tab — so a key in the URL is a key written to disk
 * hundreds of times a day, permanently. dmm already has ten real RD keys sitting
 * in those logs from the SABnzbd proxy path, which is the mistake this avoids
 * repeating.
 */
export const RD_KEY_HEADER = 'x-rd-api-key';

export async function fetchTransfers(rdKey: string): Promise<TransfersResponse> {
	const response = await fetch('/api/transfers', {
		headers: { [RD_KEY_HEADER]: rdKey },
	});
	const data = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(data?.error || `Request failed with status ${response.status}`);
	}
	return {
		transfers: Array.isArray(data?.transfers) ? (data.transfers as TransferRow[]) : [],
		degraded: Array.isArray(data?.degraded) ? (data.degraded as string[]) : [],
	};
}
