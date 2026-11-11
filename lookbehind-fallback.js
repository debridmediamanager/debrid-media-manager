// Safari before 16.4 (every iPhone stuck on iOS 15 or older) cannot parse a regex
// literal with lookbehind, `(?<=…)` or `(?<!…)`: one anywhere in a chunk is a
// SyntaxError for the whole file, so DMM never boots there. @ctrl/video-filename-parser,
// parse-torrent-title and DMM's own parsers are full of them. This turns each such
// literal in the browser bundles into the same `new RegExp(…)` call, which parses
// everywhere; on those old browsers src/utils/lookbehindShim.ts then builds it.
const acorn = require('acorn');

const LOOKBEHIND = /\(\?<[=!]/;

// Webpack chunks are scripts; a chunk that is not one (an ES module) still parses as a module.
function parse(code) {
	const options = { ecmaVersion: 'latest', allowHashBang: true };
	try {
		return acorn.parse(code, { ...options, sourceType: 'script' });
	} catch {
		return acorn.parse(code, { ...options, sourceType: 'module' });
	}
}

/** `code` with every lookbehind regex literal made a constructor call; `count` is how many were. */
function rewriteLookbehind(code) {
	if (!LOOKBEHIND.test(code)) return { code, count: 0 };
	const edits = [];
	const stack = [parse(code)];
	while (stack.length) {
		const node = stack.pop();
		if (node.type === 'Literal' && node.regex && LOOKBEHIND.test(node.regex.pattern)) {
			const { pattern, flags } = node.regex;
			edits.push([
				node.start,
				node.end,
				`new RegExp(${JSON.stringify(pattern)},${JSON.stringify(flags)})`,
			]);
			continue;
		}
		for (const key in node) {
			const value = node[key];
			if (Array.isArray(value)) {
				for (const child of value)
					if (child && typeof child.type === 'string') stack.push(child);
			} else if (value && typeof value.type === 'string') {
				stack.push(value);
			}
		}
	}
	edits.sort((a, b) => b[0] - a[0]);
	for (const [start, end, text] of edits) code = code.slice(0, start) + text + code.slice(end);
	return { code, count: edits.length };
}

/** Rewrites the client chunks after minification, before content hashes are final. */
class LookbehindFallbackPlugin {
	apply(compiler) {
		const { Compilation, sources } = compiler.webpack;
		compiler.hooks.thisCompilation.tap('LookbehindFallback', (compilation) => {
			compilation.hooks.processAssets.tap(
				{
					name: 'LookbehindFallback',
					stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
				},
				(assets) => {
					for (const name of Object.keys(assets)) {
						if (!name.endsWith('.js')) continue;
						const { code, count } = rewriteLookbehind(assets[name].source().toString());
						if (count) compilation.updateAsset(name, new sources.RawSource(code));
					}
				}
			);
		});
	}
}

module.exports = { rewriteLookbehind, LookbehindFallbackPlugin };
