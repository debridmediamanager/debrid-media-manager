// Rate limit configs for every endpoint type, and nothing else.
//
// Split out of `middlewareRateLimiter.ts` so a page can state the budgets it
// enforces instead of repeating them: that file imports ioredis, which has no
// business in a browser bundle. The numbers live here, one copy, and the setup
// guides render them.

// Rate limit configs for different endpoint types.
//
// `name` is the counter bucket. It has to be spelled out per config because the
// bucket used to be keyed on the window alone, which quietly merged every config
// sharing a window into one budget the size of the strictest member: torrents,
// zurg and sponsor all became a combined 1-per-2s, and proxy shared its second
// with default, so an /api/challenge call drained the budget /api/proxy/stream
// was about to spend.
export const RATE_LIMIT_CONFIGS = {
	stream: { name: 'stream', rateLimit: 1, windowSeconds: 5 }, // 1 request per 5 seconds for stream endpoints
	torrents: { name: 'torrents', rateLimit: 1, windowSeconds: 2 }, // 1 request per 2 seconds for torrents API
	// zurg posts a snapshot after each analysis pass and does not pace itself. Over
	// 2026-09-07..10 one zurg averaged 13 a minute and another sent 82 inside two
	// seconds, so on the `torrents` budget two posts in three were refused - and
	// their hash-imdb calls shared that counter. Sized to fit every burst seen
	// while still holding an address to 10 a second.
	snapshot: { name: 'snapshot', rateLimit: 100, windowSeconds: 10 },
	// The whole-show season resolver behind "All Seasons". It reads many season
	// rows in one request precisely so the browser does not walk `torrents` once
	// per season at 1-per-2s, which for a twenty-season show is forty seconds of
	// waiting and forty entries in a bucket shared with everyone on that IP.
	// Its own name so the two budgets stay separate, and four per minute because
	// a run asks for packs and then, only where a season has none, episodes.
	tvSeasons: { name: 'tvSeasons', rateLimit: 4, windowSeconds: 60 },
	// A season search asks two episodes at a time of every enabled Tor addon, and
	// there are five of those, so ten proxy calls land together - and the sliding
	// window still holds the previous second, so two of those bursts have to fit.
	proxy: { name: 'proxy', rateLimit: 20, windowSeconds: 2 },
	report: { name: 'report', rateLimit: 5, windowSeconds: 10 }, // 5 reports per 10 seconds
	// The zurg endpoints, sized like the Newznab and Torznab indexers rather
	// than like a person clicking: a minute's worth in one budget, so a client
	// that fans out over several titles is not refused on its second call.
	// `search-torrents` draws from here too - it used to share the `torrents`
	// bucket with the website's own search API, so a sponsor's zurg and their
	// browser spent one 1-per-2s counter between them.
	zurg: { name: 'zurg', rateLimit: 20, windowSeconds: 60 },
	zurgAdmin: { name: 'zurgAdmin', rateLimit: 1, windowSeconds: 10 }, // 1 request per 10 seconds for zurg admin endpoints
	sponsor: { name: 'sponsor', rateLimit: 1, windowSeconds: 2 }, // 1 request per 2 seconds for sponsor status endpoints
	// Every miss spends a grab from the one indexer account the whole site shares,
	// so this is paced like a stream rather than like a page fetch.
	nzbDownload: { name: 'nzbDownload', rateLimit: 1, windowSeconds: 5 },
	// The Newznab aggregation endpoint. An *arr RSS-syncs on a timer and issues
	// one search per configured indexer, so the budget is sized for a fleet of
	// them behind one sponsor key rather than for a person clicking.
	//
	// Raised from 20 on 2026-09-14. Measured over 8 days of proxy logs (81,997
	// requests, 1,981/day rising to 19,945/day): 20/min refused 125 searches
	// across 82 minutes and 14 keys, all of them *arr bursts rather than abuse.
	// 30 is the smallest budget that refuses none of it - the busiest minute any
	// key managed was 26 - and every search fans out to all four upstreams, so
	// the headroom above that is spent on the one with a metered API allowance.
	newznabSearch: { name: 'newznabSearch', rateLimit: 30, windowSeconds: 60 },
	// A grab spends a real download from the shared upstream account, so it gets
	// both a burst limit and a day-long one. Two entries, two names: same-name
	// configs share a bucket, so a single name would have made the day limit and
	// the burst limit one counter - see the note above.
	//
	// Also raised on 2026-09-14, off the same logs: grabs were the budget
	// actually biting, at 1,017 of 3,095 attempts refused. 10/min cost 569
	// requests over 56 minutes, 15/min costs 331 over 36.
	//
	// Sized against what the upstream accounts actually allow, read off their own
	// pages the same day: two are unlimited (5,122 and 4,409 API hits, 737 and
	// 176 grabs that day), but one is metered at 600 grabs and 5,000 API hits a
	// day for every DMM sponsor put together, and the fleet already attempted 999
	// grabs on 2026-09-13. So the day cap is deliberately well under that shared
	// ceiling rather than sized to the busiest key: 250 refuses 402 requests
	// across 8 days, all of them from the single key that grabbed 589 in a day.
	//
	// Note what these do NOT bound: a per-key budget times 466 keys is not an
	// aggregate. If the fleet total keeps doubling weekly, the metered upstream
	// needs a real fleet-wide counter, not a bigger per-key one.
	newznabGrab: { name: 'newznabGrab', rateLimit: 15, windowSeconds: 60 },
	newznabGrabDay: { name: 'newznabGrabDay', rateLimit: 250, windowSeconds: 86400 },
	// The cheap pre-auth reject on the newznab endpoint, per IP. Wider than
	// `default`'s 5/s because a Sonarr interactive season search bursts its
	// queries faster than that from one IP - the per-key budgets above are the
	// real limits; this only has to stop unauthenticated hammering of caps.
	//
	// Raised with them, though nothing has hit it yet: the busiest 10s bucket in
	// those 8 days was 18 requests from one IP, against a ceiling of 20. Leaving
	// it there would have turned a per-IP gate into the binding limit as soon as
	// the per-key budgets above opened up; 25 keeps a margin over that peak
	// without becoming a budget of its own.
	newznabIp: { name: 'newznabIp', rateLimit: 25, windowSeconds: 10 },
	// The Torznab indexer, sized for an *arr fleet behind one sponsor key rather
	// than for a person clicking. It kept the original 20/min when Newznab's
	// budgets were doubled, because its cost is not the same: a
	// search here reads whole library pages and classifies every hash in them
	// against the debrid caches, so it costs the database far more than a fan-out
	// to upstream indexers costs DMM. It has no grab budget — a Torznab item's
	// download is a magnet the client resolves against its own debrid account, so
	// a grab never comes back to DMM at all.
	torznabSearch: { name: 'torznabSearch', rateLimit: 20, windowSeconds: 60 },
	torznabIp: { name: 'torznabIp', rateLimit: 20, windowSeconds: 10 },
	default: { name: 'default', rateLimit: 5, windowSeconds: 1 }, // 5 requests per second for other endpoints
} as const;
