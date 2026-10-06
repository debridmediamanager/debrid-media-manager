/**
 * Reads a line of Nginx Proxy Manager's access log, the format dmm-01 records
 * every request to debridmediamanager.com in:
 *
 * [30/Sep/2026:19:21:26 +0000] - 304 304 - GET https debridmediamanager.com "/api/..." [Client 203.0.113.1] ...
 */
export interface NpmAccessLine {
	/** Epoch milliseconds. */
	at: number;
	status: number;
	/** The request path exactly as sent, still percent-encoded. */
	path: string;
	clientIp: string;
}

const LINE =
	/^\[(?<day>\d{2})\/(?<month>\w{3})\/(?<year>\d{4}):(?<time>\d{2}:\d{2}:\d{2}) \+0000\] - (?<status>\d{3}) \d{3} - GET https \S+ "(?<path>[^"]+)" \[Client (?<ip>[^\]]+)\]/;
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

export function parseNpmAccessLine(line: string): NpmAccessLine {
	const m = LINE.exec(line)?.groups;
	if (!m) throw new Error(`not an NPM access-log line: ${line}`);
	const month = MONTHS.indexOf(m.month);
	return {
		at: Date.parse(`${m.year}-${String(month + 1).padStart(2, '0')}-${m.day}T${m.time}Z`),
		status: Number(m.status),
		path: m.path,
		clientIp: m.ip,
	};
}

/** The parts of a DMM Cast stream request path, or null for any other path. */
export function castStreamRequest(path: string) {
	const m =
		/^\/api\/(?<route>stremio(?:-[a-z]{2})?)\/(?<userid>[^/]+)\/stream\/(?<mediaType>[^/]+)\/(?<item>[^/?]+)$/.exec(
			path
		)?.groups;
	return m ? { route: m.route, userid: m.userid, mediaType: m.mediaType, item: m.item } : null;
}
