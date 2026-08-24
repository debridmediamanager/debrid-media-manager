/**
 * Which notice a non-200 answer from the torrents API should raise.
 *
 * The API replies 204 with `status: requested` for a title nobody has scraped
 * yet, and queues it. Nothing drains that queue, so the banner that used to
 * follow - "the request has been received, this might take at least 5 minutes" -
 * was a promise DMM could not keep. Only `processing`, which means a scrape is
 * actually running, earns a notice; everything else settles straight to
 * `loaded` and the page stays quiet.
 */
export function searchStateFromStatusHeader(status: unknown): 'processing' | 'loaded' {
	return status === 'processing' ? 'processing' : 'loaded';
}
