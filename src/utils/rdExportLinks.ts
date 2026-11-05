import { rdCastPlayId } from './rdCastLink';
import { readRdOAuthCredentials } from './rdTokenStorage';

/** Persist the RD content key, not a CDN URL that expires seven days after mint. */
export async function getRdExportLinks(accessToken: string, links: string[]): Promise<string[]> {
	const ids = links.map((link) => {
		const id = rdCastPlayId(link);
		if (!id) throw new Error('Cannot export a non-Real-Debrid download link');
		return id;
	});
	// The play route needs a saved credential. Register before exporting, including
	// when Library was opened directly without visiting the Cast setup page.
	const response = await fetch('/api/stremio/cast/saveProfile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(readRdOAuthCredentials() ?? { apiKey: accessToken }),
	});
	if (!response.ok) throw new Error('Failed to prepare Real-Debrid playback profile');
	const profile = await response.json();
	if (typeof profile.userId !== 'string' || !profile.userId) {
		throw new Error('Real-Debrid playback profile returned no user id');
	}
	return ids.map(
		(id) =>
			`${window.location.origin}/api/stremio/${encodeURIComponent(profile.userId)}/play/${id}`
	);
}
