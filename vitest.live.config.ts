import { defineConfig } from 'vitest/config';

/**
 * Config for the opt-in live provider checks, which talk to a real account.
 *
 * Two things differ from the default config, and both are forced:
 *
 *  - **node, not jsdom.** The Debrid-Link client aborts its own timeouts with an
 *    `AbortController`, and under jsdom that signal belongs to a different realm
 *    than the undici `fetch` beneath it, which rejects it outright
 *    (`Expected signal to be an instance of AbortSignal`). A browser has one
 *    realm for both, so this is a harness artifact rather than a client defect.
 *  - **no setup file.** `src/test/setup.ts` stubs `window.matchMedia`, which does
 *    not exist under the node environment.
 *
 * Run with:
 *
 *	DL_LIVE_TOKEN=<token> npx vitest run --config vitest.live.config.ts
 *
 * Without the token the suite skips itself, which is why these files are kept
 * out of the default `include` rather than relying on that skip: a token in the
 * environment would otherwise make `npm run test` reach a real account.
 */
export default defineConfig({
	test: {
		environment: 'node',
		setupFiles: [],
		include: ['src/**/*.live.test.ts'],
	},
});
