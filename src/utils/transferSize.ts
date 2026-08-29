// The largest release the debrid uploader will attempt, mirrored here so DMM
// refuses one before it crosses the network rather than after.
//
// The uploader is a pure proxy: every byte arrives from the provider and leaves
// again for Real-Debrid, and only the outbound half is billed. Its two hosts
// cost $5.91 and €4.35 a month against a 1 TB and a 20 TB egress allowance, so
// traffic is the entire operating cost of the service. Measured over 30 days to
// 2026-08-29, **54% of all egress went to jobs that failed** — and the largest
// single category was releases too big to finish at all: 0 of 14 above 200 GB
// ever completed, while burning 6.05 TB proving it.
//
// 100 GB refuses 29 magnets carrying 8.76 TB a month, at the cost of 7 that
// would have succeeded — chosen over the break-even 200 GB (which loses none)
// to buy the extra 2.7 TB. The largest release that has ever completed is
// 186.1 GB.

/**
 * Keep in step with `MAX_JOB_BYTES` in the `debrid` service (`config.maxJobBytes`).
 *
 * Deliberately a plain constant rather than an env var: the browser and the API
 * route both read it, and a value that could differ between them would let the
 * UI block a release the service would have taken, or promise one it will
 * refuse. The service enforces its own cap regardless — this is the early,
 * friendly half of the same decision, not the load-bearing one.
 */
export const MAX_TRANSFER_BYTES = 100 * 1e9;

/**
 * Whether this release is too large to send.
 *
 * **An unknown size is never too large.** Size is missing for a result that has
 * never been through an availability check, and the service settles it anyway:
 * it learns the real size 4-12 seconds after the job starts, long before any
 * payload moves, and refuses there. Blocking on a missing number here would deny
 * transfers that are perfectly fine.
 */
export function exceedsTransferSizeCap(
	sizeBytes: number | null | undefined,
	capBytes: number = MAX_TRANSFER_BYTES
): boolean {
	if (capBytes <= 0) return false;
	if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0)
		return false;
	return sizeBytes > capBytes;
}

/** How the refusal reads to whoever tried to send it. */
export function tooLargeMessage(sizeBytes: number, capBytes: number = MAX_TRANSFER_BYTES): string {
	return (
		`too large to transfer — ${(sizeBytes / 1e9).toFixed(1)} GB, ` +
		`over the ${Math.round(capBytes / 1e9)} GB limit`
	);
}
