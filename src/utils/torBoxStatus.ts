/**
 * Maps TorBox status strings to user-friendly display text
 */
export function getTorBoxStatusText(status: string): string {
	switch (status?.toLowerCase()) {
		case 'queued':
			return 'Queued';
		case 'checking':
			return 'Checking';
		case 'downloading':
			return 'Downloading';
		case 'uploading':
			return 'Seeding'; // TorBox uses "uploading" when seeding after completion
		case 'finished':
			return 'Finished';
		case 'seeding':
			return 'Seeding';
		case 'error':
			return 'Error';
		default:
			return status; // Fallback to raw status for unknown values
	}
}
