/**
 * A release title as a filename, for the NZB that carries it.
 *
 * Strips the characters Windows rejects plus the path separators, because both
 * ends need it: nzb2rd writes this straight to disk as the job's NZB filename,
 * and a browser save from the download button lands it in someone's Downloads
 * folder.
 */
export function safeNzbName(title: string): string {
	const cleaned = title.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '').trim();
	const base = (cleaned || 'release').slice(0, 200);
	return base.toLowerCase().endsWith('.nzb') ? base : `${base}.nzb`;
}
