import type { NextApiRequest } from 'next';
import { describe, expect, it } from 'vitest';
import { readProviderKey } from './providerKeyHeader';

const req = (over: Partial<NextApiRequest>) =>
	({ headers: {}, query: {}, body: {}, ...over }) as NextApiRequest;

describe('readProviderKey', () => {
	it('prefers the Authorization header, which access logs do not record', () => {
		expect(
			readProviderKey(
				req({
					headers: { authorization: 'Bearer header-key' },
					query: { apiKey: 'query-key' },
				}),
				['apiKey']
			)
		).toBe('header-key');
	});

	it('still accepts the query string, for a page loaded before the deploy', () => {
		expect(readProviderKey(req({ query: { apiKey: 'query-key' } }), ['apiKey'])).toBe(
			'query-key'
		);
	});

	it('tries each accepted query name in order', () => {
		expect(readProviderKey(req({ query: { rdToken: 'k' } }), ['token', 'rdToken'])).toBe('k');
	});

	it('falls back to the request body', () => {
		expect(readProviderKey(req({ body: { apiKey: 'body-key' } }), ['apiKey'])).toBe('body-key');
	});

	it('ignores an empty or malformed header', () => {
		expect(
			readProviderKey(req({ headers: { authorization: 'Bearer   ' } }), ['apiKey'])
		).toBeNull();
		expect(
			readProviderKey(req({ headers: { authorization: 'Basic abc' } }), ['apiKey'])
		).toBeNull();
	});

	it('returns null when there is no key anywhere', () => {
		expect(readProviderKey(req({}), ['apiKey'])).toBeNull();
	});
});
