/** "37d ago" style age for a timestamp, for lists that show the full time in a tooltip. */
export function timeAgo(iso: string | Date, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
	if (seconds < 60) return 'just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

/** "10/24" in the viewer's locale, for row dates whose full time goes in a tooltip. */
export const shortDate = (iso: string | Date) =>
	new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
