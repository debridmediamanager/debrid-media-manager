import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { getMetadataCache } from '@/services/metadataCache';
import { describeProviderError, ProviderCooldownError } from '@/services/providerCooldown';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * TMDB's v3 reads for a sponsor's own tools, answered from DMM's metadata cache
 * with DMM's key: `/api/metadata/tmdb/tv/1399/season/1` is
 * `api.themoviedb.org/3/tv/1399/season/1`, body and status, so a TMDB client
 * only changes its base URL. rex reads its seasons' episode lists through here.
 *
 * Only the reads below pass, with only the parameters that shape them; anything
 * else, a caller's own `api_key` included, is refused or dropped, so the cache
 * cannot be filled with arbitrary keys.
 */
const PATHS = [
	/^movie\/\d+$/,
	/^tv\/\d+$/,
	/^tv\/\d+\/season\/\d+$/,
	/^tv\/\d+\/season\/\d+\/episode\/\d+$/,
	/^(movie|tv)\/\d+\/external_ids$/,
	/^find\/[A-Za-z0-9]{1,20}$/,
	/^search\/(movie|tv|multi)$/,
];

const PARAMS: Record<string, RegExp> = {
	language: /^[a-z]{2}(-[A-Z]{2})?$/,
	append_to_response: /^[a-z_]+(,[a-z_]+){0,9}$/,
	external_source: /^(imdb_id|tvdb_id)$/,
	query: /^.{1,200}$/,
	year: /^\d{4}$/,
	first_air_date_year: /^\d{4}$/,
	page: /^\d{1,3}$/,
	include_adult: /^(true|false)$/,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const segments = Array.isArray(req.query.path) ? req.query.path : [];
	const path = segments.join('/');
	if (!PATHS.some((allowed) => allowed.test(path))) {
		return res.status(404).json({ error: 'Not a TMDB read this API serves' });
	}
	const params: Record<string, string> = {};
	for (const [name, pattern] of Object.entries(PARAMS)) {
		const value = req.query[name];
		if (typeof value !== 'string' || value === '') continue;
		if (!pattern.test(value)) return res.status(400).json({ error: `Bad ${name}` });
		params[name] = value;
	}

	const sponsor = await sponsorOfDmmApiKeyHeader(req, res);
	if (!sponsor) return;
	// Per sponsorship rather than per address: one sponsor's servers share one
	// budget wherever they run, as with the Torznab and Newznab indexers.
	if (
		!(await checkRateLimitFor(`sponsor:${sponsor.shortId}`, RATE_LIMIT_CONFIGS.metadata, res))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}

	try {
		const data = await getMetadataCache().getTmdbPassthrough(path, params);
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json(data);
	} catch (error) {
		if (error instanceof ProviderCooldownError) {
			const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
			res.setHeader('Retry-After', String(seconds));
			return res
				.status(503)
				.json({ error: 'TMDB is rate-limiting DMM', retryAfter: seconds });
		}
		// TMDB's own "no such id" passes through as TMDB said it.
		const response = (error as { response?: { status?: number; data?: unknown } })?.response;
		if (response?.status === 404) return res.status(404).json(response.data ?? {});
		const line = describeProviderError(error);
		console.error(`[metadata] tmdb ${path} failed: ${line ?? String(error)}`);
		return res.status(502).json({ error: 'TMDB did not answer' });
	}
}
