import { getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { defaultResultsTab } from '@/utils/settings';
import type { ParsedUrlQuery } from 'querystring';

export const RESULTS_TAB_SETTING = 'settings:defaultResultsTab';

/**
 * Whether a title's torrent page should open its Usenet tab instead: the viewer
 * chose Usenet as the tab results open on, and did not just ask for torrents
 * with the Torrents tab (`?tab=torrents`), which would otherwise bounce back.
 */
export function opensOnUsenet(query: ParsedUrlQuery): boolean {
	return (
		query.tab !== 'torrents' &&
		getLocalStorageItemOrDefault(RESULTS_TAB_SETTING, defaultResultsTab) === 'usenet'
	);
}

/** The Usenet route for a torrent page's query, keeping everything but `tab`. */
export function usenetRouteFor(pathname: string, query: ParsedUrlQuery) {
	const { tab: _tab, ...rest } = query;
	return { pathname: `${pathname}/usenet`, query: rest };
}
