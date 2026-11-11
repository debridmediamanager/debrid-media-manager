import { openApiDocument } from '@/utils/openapi';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// The browser check (Turnstile, the challenge token, the DMM-pages-only gate) is
// for DMM's own web app. Tools use the routes /api-docs documents, so none of
// those may depend on it, or a sponsor's script would start failing.
const API_DIR = path.join(process.cwd(), 'src/pages/api');
const WEB_APP_ONLY = /validateProblemToken|validateOwnPageRequest|turnstile/i;

/** The page file Next routes a documented path to, catch-alls included. */
function routeFile(apiPath: string): string {
	const segments = apiPath
		.replace(/^\/api\//, '')
		.split('/')
		.map((s) => s.replace(/^\{(.+)\}$/, '[$1]'));
	let dir = API_DIR;
	for (let i = 0; i < segments.length; i++) {
		const rest = segments.length - i;
		const entries = readdirSync(dir);
		const catchAll = entries.find((e) => /^\[\[?\.\.\./.test(e));
		const seg = segments[i];
		if (rest === 1 && entries.includes(`${seg}.ts`)) return path.join(dir, `${seg}.ts`);
		if (entries.includes(seg) && existsSync(path.join(dir, seg))) {
			const next = path.join(dir, seg);
			if (rest === 1 && existsSync(path.join(next, 'index.ts')))
				return path.join(next, 'index.ts');
			if (rest > 1) {
				dir = next;
				continue;
			}
		}
		const dynamic = entries.find((e) => /^\[[^.]/.test(e));
		if (dynamic && rest > 1 && !dynamic.endsWith('.ts')) {
			dir = path.join(dir, dynamic);
			continue;
		}
		if (dynamic && rest === 1 && dynamic.endsWith('.ts')) return path.join(dir, dynamic);
		if (catchAll) return path.join(dir, catchAll);
		break;
	}
	throw new Error(`no route file for ${apiPath}`);
}

describe('routes on /api-docs', () => {
	const paths = Object.keys(openApiDocument.paths);

	it('are all found', () => {
		expect(paths.length).toBeGreaterThan(20);
		for (const p of paths) expect(() => routeFile(p), p).not.toThrow();
	});

	it.each(paths)('%s never asks for the web app browser check', (p) => {
		expect(readFileSync(routeFile(p), 'utf8')).not.toMatch(WEB_APP_ONLY);
	});
});
