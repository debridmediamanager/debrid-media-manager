import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { openApiDocument } from '@/utils/openapi';

const API = join(__dirname, '../../pages');

type Operation = {
	tags: string[];
	description?: string;
	security?: unknown[];
	operationId?: string;
};
const operations = Object.entries(openApiDocument.paths).flatMap(([path, methods]) =>
	Object.entries(methods as Record<string, Operation>)
		.filter(([method]) => method !== 'parameters')
		.map(([method, op]) => ({
			path,
			method,
			op,
		}))
);
const byPath = (path: string) => operations.find((o) => o.path === path)!.op;

/** The Next route file a documented path resolves to, catch-alls included. */
function routeExists(path: string): boolean {
	const segments = path.split('/').filter(Boolean);
	const walk = (dir: string, rest: string[]): boolean => {
		if (rest.length === 0) return existsSync(`${dir}.ts`) || existsSync(join(dir, 'index.ts'));
		const [head, ...tail] = rest;
		if (head.startsWith('{')) {
			return ['[id]', '[userid]', '[...route]', '[[...path]]'].some((name) =>
				name.includes('...')
					? existsSync(join(dir, `${name}.ts`))
					: walk(join(dir, name), tail)
			);
		}
		return (
			walk(join(dir, head), tail) ||
			existsSync(join(dir, '[...route].ts')) ||
			existsSync(join(dir, '[[...path]].ts'))
		);
	};
	return walk(API, segments);
}

describe('/api-docs OpenAPI document', () => {
	it('is OpenAPI 3.1 with a unique operationId per operation', () => {
		expect(openApiDocument.openapi).toBe('3.1.0');
		const ids = operations.map((o) => o.op.operationId).filter(Boolean);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it.each(operations.map((o) => o.path))('%s is a real route', (path) => {
		expect(routeExists(path)).toBe(true);
	});

	it('gates every sponsor operation on a key and leaves open ones open', () => {
		for (const { path, op } of operations) {
			const open = op.tags.includes('Open');
			expect(op.security?.length === 0, path).toBe(open);
		}
	});

	it('resolves every $ref', () => {
		const text = JSON.stringify(openApiDocument);
		for (const [, kind, name] of text.matchAll(/"#\/components\/(\w+)\/(\w+)"/g)) {
			expect(
				(openApiDocument.components as Record<string, Record<string, unknown>>)[kind][name],
				`${kind}/${name}`
			).toBeDefined();
		}
	});

	it('states the limits the routes enforce', () => {
		expect(byPath('/api/sponsor/identify').description).toMatch(/5 calls per minute/);
		expect(byPath('/api/sponsor/availability').description).toMatch(/25 calls per minute/);
		expect(byPath('/api/torrents/identify').description).toMatch(/5 calls per minute/);
		expect(byPath('/api/sponsor/place').description).toMatch(/60 calls per minute per key/);
		expect(byPath('/api/metadata/{id}').description).toMatch(/300 calls per minute per key/);
		expect(byPath('/api/takedown').description).toMatch(/20 notices per hour/);
		expect(byPath('/api/plugins/manifest.json').description).toMatch(/5 requests per second/);
	});

	it('tells SABnzbd users the allowance and where a sponsor key goes', () => {
		const sab = byPath('/api/sabnzbd/{mountRoot}/api');
		expect(sab.description).toMatch(/300 GB of Usenet per account, 2 TB/);
		expect(sab.description).toMatch(/your DMM API key as the Password/);
	});

	it('tells the two identify endpoints apart by what they read', () => {
		expect(byPath('/api/sponsor/identify').description).toMatch(/from each release filename/);
		expect(byPath('/api/torrents/identify').description).toMatch(
			/without reading any filename/
		);
	});
});

describe('/api-docs page', () => {
	const html = readFileSync(join(__dirname, '../../../public/api-docs.html'), 'utf8');

	// Scalar's standalone bundle auto-mounts an empty second app on id="api-reference":
	// the page then opened on loading skeletons with a second, blank sidebar.
	it('mounts Scalar once, on an element Scalar does not claim itself', () => {
		expect(html).not.toMatch(/id=["']api-reference["']/);
		expect(html.match(/createApiReference\(/g)).toHaveLength(1);
		expect(html).toMatch(/createApiReference\('#app'/);
		expect(html).toContain('<div id="app"></div>');
	});

	it('keeps code cards inside a phone screen', () => {
		expect(html).toContain('.scalar-card-content { grid-template-columns: minmax(0, 1fr); }');
	});

	it('is what /api-docs serves', async () => {
		const config = require('../../../next.config.js');
		const { afterFiles } = await (config.rewrites ?? config.default?.rewrites)();
		expect(afterFiles).toContainEqual({ source: '/api-docs', destination: '/api-docs.html' });
	});
});
