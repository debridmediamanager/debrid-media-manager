import { RegExpParser, visitRegExpAST } from '@eslint-community/regexpp';
import { parse } from 'acorn';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { LOOKBEHIND_SHIM_SCRIPT } from '@/utils/lookbehindShim';
import { describe, expect, it } from 'vitest';

// Every lookbehind regex in debridmediamanager.com's client chunks on 2026-11-11.
// Safari before 16.4 (iOS 15) refused those chunks outright, and DMM hung on
// "DMM did not finish loading" on an iPhone SE.
import live from '../fixtures/lookbehind-regexes.live.json';

const require = createRequire(import.meta.url);
const { rewriteLookbehind } = require('../../../lookbehind-fallback.js');

const NativeRegExp = RegExp;
type Regex = (typeof live)[number];

const hasLookbehind = (pattern: string, flags = '') => {
	const ast = new RegExpParser().parsePattern(pattern, 0, pattern.length, {
		unicode: flags.includes('u'),
		unicodeSets: flags.includes('v'),
	});
	let found = false;
	visitRegExpAST(ast, {
		onAssertionEnter(node) {
			if (node.kind === 'lookbehind') found = true;
		},
	});
	return found;
};

/** Regex literals Safari 15's parser refuses, which fail the whole script there. */
const lookbehindLiterals = (code: string) => {
	const found: string[] = [];
	const stack: any[] = [parse(code, { ecmaVersion: 'latest' })];
	while (stack.length) {
		const node = stack.pop();
		if (
			node.type === 'Literal' &&
			node.regex &&
			hasLookbehind(node.regex.pattern, node.regex.flags)
		) {
			found.push(node.raw);
		}
		for (const value of Object.values(node)) {
			for (const child of Array.isArray(value) ? value : [value]) {
				if (child && typeof child === 'object' && typeof child.type === 'string')
					stack.push(child);
			}
		}
	}
	return found;
};

// Safari 15's RegExp constructor: a pattern with lookbehind is a SyntaxError.
function Safari15RegExp(pattern?: unknown, flags?: string) {
	const source = pattern instanceof NativeRegExp ? pattern.source : String(pattern);
	if (hasLookbehind(source, flags)) {
		throw new SyntaxError('Invalid regular expression: invalid group specifier name');
	}
	return new NativeRegExp(pattern as string, flags);
}
Safari15RegExp.prototype = NativeRegExp.prototype;

/** The RegExp a page sees once _document's shim has run in `window`. */
const afterShim = (RegExpImpl: unknown) => {
	const window = { RegExp: RegExpImpl };
	new Function('window', LOOKBEHIND_SHIM_SCRIPT)(window);
	return window.RegExp as RegExpConstructor;
};

const asCode = ({ pattern, flags, form }: Regex) =>
	form === 'literal'
		? `return /${pattern}/${flags};`
		: `return new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)});`;

const run = (body: string, RegExpImpl: unknown) =>
	new Function('RegExp', body)(RegExpImpl) as RegExp;

describe('DMM on Safari before 16.4', () => {
	it('the captured production regexes are the shape that broke it', () => {
		const literals = live.filter((r) => r.form === 'literal');
		expect(literals.length).toBeGreaterThan(80);
		for (const r of literals)
			expect(lookbehindLiterals(`(function(){${asCode(r)}})`)).toHaveLength(1);
	});

	it.each(live)('$chunk /$pattern/$flags', (regex) => {
		const { code, count } = rewriteLookbehind(`(function(){${asCode(regex)}})`);
		expect(count).toBe(regex.form === 'literal' ? 1 : 0);
		expect(lookbehindLiterals(code)).toEqual([]);

		const body = code.slice('(function(){'.length, -'})'.length);
		const loose = run(body, afterShim(Safari15RegExp));
		expect(hasLookbehind(loose.source, loose.flags)).toBe(false);
		expect(loose.flags).toBe(new NativeRegExp('', regex.flags).flags);

		expect(run(body, afterShim(NativeRegExp)).source).toBe(
			new NativeRegExp(regex.pattern, regex.flags).source
		);
	});

	// What still crashed once the chunks parsed: a pattern assembled at runtime from
	// String.raw pieces, which no build step sees. This runs the library's own module.
	it("runs @ctrl/video-filename-parser's runtime-built website pattern", () => {
		const file = path.join(
			process.cwd(),
			'node_modules/@ctrl/video-filename-parser/dist/src/website.js'
		);
		const body = readFileSync(file, 'utf8').replace(/^export /gm, '');
		const load = (RegExpImpl: unknown) =>
			new Function('RegExp', `${body}; return { removeWebsitePrefix };`)(RegExpImpl);

		expect(() => load(Safari15RegExp)).toThrow(SyntaxError);
		const { removeWebsitePrefix } = load(afterShim(Safari15RegExp));
		expect(removeWebsitePrefix('[www.Example.com] - Movie.2020.1080p')).toBe(
			'Movie.2020.1080p'
		);
	});
});

describe('the lookbehind shim', () => {
	it('leaves RegExp alone where lookbehind works', () => {
		expect(afterShim(NativeRegExp)).toBe(NativeRegExp);
	});

	it.each([
		['(?<!\\d)7[\\W_][01]\\b', '7[\\W_][01]\\b'],
		['(?<=S\\d{2}E)\\d+', '\\d+'],
		['(?<![()[!])x', 'x'],
		['(?<!\\(x)y', 'y'],
		['(?<!(?:seasons?|[Сс]езони?)\\W*)(\\d)', '(\\d)'],
		['(?<title>.+?)(?<!\\d+)\\d', '(?<title>.+?)\\d'],
		['\\(?<!x', '\\(?<!x'],
		['[(?<!]a', '[(?<!]a'],
	])('builds %s as %s', (pattern, expected) => {
		expect(new (afterShim(Safari15RegExp))(pattern, 'i').source).toBe(expected);
	});

	it('keeps RegExp semantics', () => {
		const ShimmedRegExp = afterShim(Safari15RegExp);
		const re = /a/g;
		expect(ShimmedRegExp(re)).toBe(re);
		expect(new ShimmedRegExp(re).flags).toBe('g');
		expect(re instanceof ShimmedRegExp).toBe(true);
		expect(() => new ShimmedRegExp('(')).toThrow(SyntaxError);
	});

	it('leaves bundles without lookbehind literals untouched', () => {
		const code = 'var a = /(?<name>x)(?=y)/g, b = new RegExp(dynamic);';
		expect(rewriteLookbehind(code)).toEqual({ code, count: 0 });
	});
});
