export type SearchSourceStatus = 'loading' | 'done' | 'error';

export type SearchSourceState = {
	status: SearchSourceStatus;
	/** unique results this source contributed after dedup against the other sources */
	count: number;
};

export type SearchSourceStates = Record<string, SearchSourceState>;

/** the DMM scrape database - always searched, and the only source that paginates */
export const DMM_SOURCE = 'DMM';

const SOURCE_LABELS: Record<string, string> = {
	[DMM_SOURCE]: 'DMM',
	torrentio: 'Torrentio',
	comet: 'Comet',
	mediafusion: 'MediaFusion',
	peerflix: 'Peerflix',
	torrentsdb: 'TorrentsDB',
};

/** "mediafusion-tor" -> "MediaFusion (Tor)" */
export function formatSourceLabel(source: string): string {
	const isTor = source.endsWith('-tor');
	const base = isTor ? source.slice(0, -'-tor'.length) : source;
	const label = SOURCE_LABELS[base] ?? base;
	return isTor ? `${label} (Tor)` : label;
}

/** every source starts pending; externals only run on the first page */
export function initSourceStates(externalSources: string[]): SearchSourceStates {
	const states: SearchSourceStates = { [DMM_SOURCE]: { status: 'loading', count: 0 } };
	for (const source of externalSources) {
		states[source] = { status: 'loading', count: 0 };
	}
	return states;
}

export function markSourceResults(
	states: SearchSourceStates,
	source: string,
	added: number
): SearchSourceStates {
	const previous = states[source];
	if (!previous) return states;
	return { ...states, [source]: { ...previous, count: previous.count + added } };
}

export function markSourceStatus(
	states: SearchSourceStates,
	source: string,
	status: SearchSourceStatus
): SearchSourceStates {
	const previous = states[source];
	if (!previous) return states;
	return { ...states, [source]: { ...previous, status } };
}
