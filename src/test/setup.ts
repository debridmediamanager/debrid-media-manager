import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';

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

// Mock window.matchMedia
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
