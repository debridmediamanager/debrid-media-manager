/**
 * Maps Premiumize transfer statuses to user-friendly display text.
 *
 * `stored` is DMM's own: it marks content sitting in the Premiumize cloud that
 * no transfer record points at any more, which is what a user is left with after
 * `transfer/clearfinished`.
 */
export function getPremiumizeStatusText(status: string): string {
	switch (status?.toLowerCase()) {
		case 'queued':
			return 'Queued';
		case 'running':
			return 'Downloading';
		case 'finished':
			return 'Finished';
		case 'seeding':
			// Premiumize keeps seeding after the files are already in the cloud
			return 'Seeding';
		case 'error':
			return 'Error';
		case 'stored':
			return 'In cloud';
		default:
			return status;
	}
}
