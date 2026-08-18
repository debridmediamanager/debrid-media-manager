import { trapsForRotation } from '@/utils/canary';
import { useEffect, useState } from 'react';

/**
 * Publishes the current trap rotation where only a machine reads.
 *
 * These are impossible titles (see src/utils/canary.ts) - ids no real user can
 * reach - rendered into a hidden container so a scraper that harvests hrefs out
 * of the DOM follows one and trips the tripwire on /api/torrents/*.
 *
 * Rendered after mount rather than during SSR on purpose: the traps then exist
 * only in the live DOM and never in the served HTML, so nothing that merely
 * fetches the page - a search engine included - can see them. Only something
 * driving a real browser does, which is exactly the traffic worth catching.
 */
export default function CanaryLinks() {
	const [traps, setTraps] = useState<string[]>([]);

	useEffect(() => {
		setTraps(trapsForRotation());
	}, []);

	if (traps.length === 0) return null;

	return (
		<div aria-hidden="true" hidden style={{ display: 'none' }} data-nosnippet>
			{traps.map((imdbId) => (
				<a key={imdbId} href={`/movie/${imdbId}`} rel="nofollow" tabIndex={-1}>
					{imdbId}
				</a>
			))}
		</div>
	);
}
