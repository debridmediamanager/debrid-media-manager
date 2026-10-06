/** OMDb's and MDBList's `apikey` and TMDB's v3 `api_key`: the credentials DMM puts in a URL. */
const CREDENTIAL_PARAM = /([?&](?:apikey|api_key)=)[^&#\s]*/gi;

/**
 * A request URL fit for a log line. Every fetch is logged, and production wrote
 * DMM's OMDb and TMDB keys into its container logs that way.
 */
export function redactUrl(url: string): string {
	return url.replace(CREDENTIAL_PARAM, '$1REDACTED');
}

function scrubConfig(config: unknown): void {
	if (!config || typeof config !== 'object') return;
	const record = config as { url?: unknown; params?: unknown; headers?: unknown };
	if (typeof record.url === 'string') record.url = redactUrl(record.url);
	if (record.params && typeof record.params === 'object') {
		const params = record.params as Record<string, unknown>;
		for (const key of Object.keys(params)) {
			if (/^api_?key$/i.test(key)) params[key] = 'REDACTED';
		}
	}
	if (record.headers && typeof record.headers === 'object') {
		const headers = record.headers as Record<string, unknown>;
		for (const key of Object.keys(headers)) {
			if (/^authorization$/i.test(key)) headers[key] = 'REDACTED';
		}
	}
}

/**
 * Takes the credentials out of a failed request's error, in place.
 *
 * An Axios error repeats the URL in `config.url` and in the path and raw header
 * of `request` (which `response.request` shares), and a bearer token in
 * `config.headers`. Callers log these errors whole — `settle`, `getOmdbMetadata`,
 * the info routes and the MDBList client all do — so each copy is scrubbed and
 * the request objects dropped. The error keeps its class and `response`, which
 * callers branch on.
 */
export function scrubRequestError(error: unknown): void {
	if (!error || typeof error !== 'object') return;
	const record = error as { config?: unknown; request?: unknown; response?: unknown };
	scrubConfig(record.config);
	if ('request' in record) record.request = undefined;
	if (record.response && typeof record.response === 'object') {
		const response = record.response as { config?: unknown; request?: unknown };
		scrubConfig(response.config);
		if ('request' in response) response.request = undefined;
	}
}
