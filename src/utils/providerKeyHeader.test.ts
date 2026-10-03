import { createMockResponse } from '@/test/utils/api';
import type { NextApiRequest } from 'next';
import { describe, expect, it } from 'vitest';
import { readBearerKey, readProviderKey, refuseQueryKey } from './providerKeyHeader';

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

describe('readBearerKey', () => {
	it('reads only the Authorization header', () => {
		expect(readBearerKey(req({ headers: { authorization: 'Bearer header-key' } }))).toBe(
			'header-key'
		);
		expect(readBearerKey(req({ query: { token: 'query-key' } }))).toBeNull();
		expect(readBearerKey(req({ body: { token: 'body-key' } }))).toBeNull();
	});

	it('ignores an empty or non-bearer header', () => {
		expect(readBearerKey(req({ headers: { authorization: 'Bearer   ' } }))).toBeNull();
		expect(readBearerKey(req({ headers: { authorization: 'Basic abc' } }))).toBeNull();
	});
});

describe('refuseQueryKey', () => {
	it('answers 400 when the query carries a key, without echoing it', () => {
		const res = createMockResponse();
		expect(refuseQueryKey(req({ query: { token: 'SECRET' } }), res, ['token'])).toBe(true);
		expect(res._getStatusCode()).toBe(400);
		expect(JSON.stringify(res._getData())).not.toContain('SECRET');
	});

	it('refuses an empty or repeated parameter too', () => {
		expect(refuseQueryKey(req({ query: { token: '' } }), createMockResponse(), ['token'])).toBe(
			true
		);
		expect(
			refuseQueryKey(req({ query: { token: ['a', 'b'] } }), createMockResponse(), ['token'])
		).toBe(true);
	});

	it('lets a request without a query key through untouched', () => {
		const res = createMockResponse();
		expect(refuseQueryKey(req({ query: { hash: 'h' } }), res, ['token'])).toBe(false);
		expect(res.status).not.toHaveBeenCalled();
	});
});
