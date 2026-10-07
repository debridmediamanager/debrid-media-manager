import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';

// Waits for a page to render are not timing assertions. The 1 s default made
// findBy*/waitFor fail whenever the machine was busy (two cores on zen, a
// shared Mac), while a real hang still fails, just later.
configure({ asyncUtilTimeout: 10_000 });
// Likewise vitest's own 5 s per-test limit, which none of these tests assert on.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// Mock rate limiting wrappers to pass through handlers unchanged in tests
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	withRateLimit: (handler: unknown) => handler,
	withCustomRateLimit: (handler: unknown) => handler,
	withIpRateLimit: (handler: unknown) => handler,
	RATE_LIMIT_CONFIGS: {
		stream: { rateLimit: 1, windowSeconds: 5 },
		torrents: { rateLimit: 1, windowSeconds: 2 },
		default: { rateLimit: 5, windowSeconds: 1 },
	},
}));

// Mock window.matchMedia. A file that opts into `@vitest-environment node` has
// no window to mock.
if (typeof window !== 'undefined') {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: vi.fn().mockImplementation((query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
}

// Silence console.error in tests to avoid non-zero exit codes on intentional error logs
vi.spyOn(console, 'error').mockImplementation(() => {});

// Nothing is blocked unless a test says so, and no test reaches the database
// for the takedown list. The blocklist tests reset this themselves. Imported
// here rather than at the top, so a test file's vi.mock of the modules behind
// it still applies.
beforeEach(async () => {
	const { setBlocklistForTests } = await import('@/services/takedown/blocklist');
	setBlocklistForTests([]);
});

// A provider's 429 cools that host down for the whole process; one test's
// refusal must not skip the next test's requests.
beforeEach(async () => {
	const { resetProviderCooldowns } = await import('@/services/providerCooldown');
	resetProviderCooldowns();
});
