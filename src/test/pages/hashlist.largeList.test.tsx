import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import path from 'path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A real shared list, the one reported as a white page on 2026-09-29: 27,991
// torrents in a 1.98 MB fragment (see fixtures/hashlist/README.md). Decoded
// with the real lz-string, exactly as the page reads it from the iframe URL.
const FRAGMENT = readFileSync(
	path.join(__dirname, '../fixtures/hashlist/421ab9ff-ed7f-4c0b-9f66-ee91f12d57eb.fragment.txt'),
	'utf8'
);
// What the page lists once blocked hashes and year-less movies drop out.
const LISTED = 27784;

const auth = vi.hoisted(() => ({ rdKey: null as string | null }));

vi.mock('next/router', () => ({
	useRouter: vi.fn(() => ({
		push: vi.fn(),
		replace: vi.fn(),
		query: {},
		pathname: '/hashlist',
		asPath: '/hashlist',
		events: { on: vi.fn(), off: vi.fn() },
	})),
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: vi.fn(() => [auth.rdKey, false, false]),
	useAllDebridApiKey: vi.fn(() => null),
	useTorBoxAccessToken: vi.fn(() => null),
	usePremiumizeCredential: vi.fn(() => null),
	useOffcloudApiKey: vi.fn(() => null),
	useDebridLinkCredential: vi.fn(() => null),
}));

vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: vi.fn(() => ({
		addTorrent: vi.fn(),
		removeTorrent: vi.fn(),
		lastFetchTime: null,
	})),
}));

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(() => ({
		initializeDB: vi.fn().mockResolvedValue(undefined),
		all: vi.fn().mockResolvedValue([]),
		hashes: vi.fn().mockResolvedValue(new Set()),
	})),
}));

vi.mock('@/utils/takedownClient', () => ({
	fetchBlockedHashes: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock('@/utils/token', () => ({
	generateTokenAndHash: vi.fn().mockResolvedValue(['problem', 'solution']),
}));

// The real classifier, counted: one call per row means one parse per row.
const classified = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/utils/mediaType', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/utils/mediaType')>();
	return {
		...actual,
		getTypeByName: (filename: string) => {
			classified.count++;
			return actual.getTypeByName(filename);
		},
	};
});

vi.mock('react-hot-toast', () => ({
	toast: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
		loading: vi.fn(),
		custom: vi.fn(),
		dismiss: vi.fn(),
		promise: vi.fn((p: Promise<unknown>) => p),
	}),
	Toaster: () => null,
}));

// DMM's availability endpoints, old and new, answering that every hash asked
// about is cached with a video. `hold` parks every request after the first.
function availabilityServer({ hold = false } = {}) {
	let calls = 0;
	return vi.fn(async (url: string, init?: RequestInit) => {
		const { hashes } = JSON.parse(String(init?.body ?? '{}')) as { hashes: string[] };
		if (hold && calls++ > 0) return new Promise<Response>(() => {});
		if (url.includes('/api/availability/check2')) {
			return new Response(
				JSON.stringify({
					available: hashes.map((hash) => ({
						hash,
						files: [{ file_id: 1, path: 'Release.mkv', bytes: 1 }],
					})),
				})
			);
		}
		if (url.includes('/api/availability/playable')) {
			return new Response(
				JSON.stringify({ cached: hashes.map((hash) => hash.toLowerCase()) })
			);
		}
		throw new Error(`unexpected fetch ${url}`);
	});
}

const rdDownloadCount = () => {
	const button = screen.queryByText(/^RD Download \(\d+\)$/);
	return button ? Number(button.textContent!.match(/\d+/)![0]) : -1;
};

describe('HashlistPage with a 27,991-item shared list', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		const { generateTokenAndHash } = await import('@/utils/token');
		vi.mocked(generateTokenAndHash).mockReset().mockResolvedValue(['problem', 'solution']);
		auth.rdKey = null;
		classified.count = 0;
		Object.defineProperty(window, 'location', {
			writable: true,
			value: { hash: `#${FRAGMENT}`, reload: vi.fn() },
		});
		vi.spyOn(window.sessionStorage.__proto__, 'getItem').mockReturnValue(null);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// Before: filterList de-duplicated with findIndex inside filter, comparing
	// every row with every earlier row on every pass - on load, and again for
	// each character typed into the search box.
	it('lists the whole list and answers a search without stalling', async () => {
		const HashlistPage = (await import('@/pages/hashlist')).default;
		// CPU time of this test process, not wall time: the pre-commit hook runs
		// ~650 files in parallel, which stretches wall time but not work done.
		const started = process.cpuUsage();
		render(<HashlistPage />);

		await waitFor(
			() =>
				expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
					`Aster's hashlist (${LISTED} files in total; size: 607.9 TB)`
				),
			{ timeout: 90000 }
		);
		await screen.findAllByText(`1/${Math.ceil(LISTED / 100)}`, undefined, { timeout: 90000 });

		const search = screen.getByPlaceholderText(
			'quick search on filename, hash, or id; supports regex'
		);
		for (const text of ['a', 'aq', 'aqu']) {
			fireEvent.change(search, { target: { value: text } });
		}
		await waitFor(
			() =>
				expect(
					screen.getByText('Aquarius 2015 Season 2 Complete 720p WEB-DL x264 [i_c]')
				).toBeInTheDocument(),
			{ timeout: 90000 }
		);
		await screen.findAllByText('1/1', undefined, { timeout: 90000 });
		const { user, system } = process.cpuUsage(started);
		const cpuMs = (user + system) / 1000;

		// Measured here on an M-series Mac: 23.0 s of CPU unfixed, 3.7 s fixed.
		expect(cpuMs).toBeLessThan(10000);
	}, 180000);

	// Before: the RD check was 278 requests of 100 hashes behind a 10-per-10-s
	// limiter meant for Real-Debrid's API, and "Show Instant" listed nothing
	// until the last one answered - ~4.8 minutes on production.
	it('fills the Show Instant table from the availability check within seconds', async () => {
		auth.rdKey = 'rd-token';
		vi.stubGlobal('fetch', availabilityServer());
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		await waitFor(() => expect(rdDownloadCount()).toBe(LISTED), { timeout: 60000 });
	}, 180000);

	it('shows cached rows while later availability batches are still out', async () => {
		auth.rdKey = 'rd-token';
		vi.stubGlobal('fetch', availabilityServer({ hold: true }));
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		// One batch answered; the other 55 never will.
		await waitFor(() => expect(rdDownloadCount()).toBeGreaterThan(0), { timeout: 60000 });
		expect(rdDownloadCount()).toBeLessThan(LISTED);
	}, 180000);

	// The same list stored beside its page, which is how a list past Chrome's
	// 2 MB URL limit can be opened at all; the fragment only names it.
	it('opens a list stored beside its page', async () => {
		const id = '421ab9ff-ed7f-4c0b-9f66-ee91f12d57eb';
		window.location.hash = `#id=${id}`;
		const fetchMock = vi.fn(async (url: string) => {
			if (url === `https://hashlists.debridmediamanager.com/lists/${id}.txt`) {
				return new Response(FRAGMENT);
			}
			throw new Error(`unexpected fetch ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		await waitFor(
			() =>
				expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
					`Aster's hashlist (${LISTED} files in total; size: 607.9 TB)`
				),
			{ timeout: 90000 }
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	}, 180000);

	// Before: the Real-Debrid token request shared the list's try block, and
	// its catch emptied the list - "0 files in total" on a list that had loaded.
	it('keeps the list when an availability check cannot start', async () => {
		const { generateTokenAndHash } = await import('@/utils/token');
		vi.mocked(generateTokenAndHash).mockRejectedValueOnce(new Error('challenge 500'));
		const { toast } = await import('react-hot-toast');
		auth.rdKey = 'rd-token';
		vi.stubGlobal('fetch', availabilityServer());
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		await waitFor(() => expect(generateTokenAndHash).toHaveBeenCalled(), { timeout: 90000 });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
			`(${LISTED} files in total`
		);
		expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch user torrents.');
		await expect(vi.mocked(toast.promise).mock.results[0].value).rejects.toThrow(
			'challenge 500'
		);
	}, 180000);

	// Before: the load effect re-ran when a debrid key hydrated after mount,
	// while the first load was still going, and parsed every filename again.
	it('parses the list once when a key hydrates after mount', async () => {
		vi.stubGlobal('fetch', availabilityServer());
		const HashlistPage = (await import('@/pages/hashlist')).default;
		const { rerender } = render(<HashlistPage />);
		auth.rdKey = 'rd-token';
		rerender(<HashlistPage />);

		await waitFor(() => expect(rdDownloadCount()).toBe(LISTED), { timeout: 90000 });
		expect(classified.count).toBe(27991); // every row, once
	}, 180000);

	// Before: every filename was parsed in one task, ~2.5 s here and ~27 s in
	// Chrome for a 176k-item list, with the page frozen throughout.
	it('keeps the page responsive while it parses the list', async () => {
		const ticks: number[] = [];
		const timer = setInterval(() => ticks.push(performance.now()), 5);
		const HashlistPage = (await import('@/pages/hashlist')).default;
		const started = performance.now();
		render(<HashlistPage />);
		await waitFor(
			() =>
				expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
					`(${LISTED} files in total`
				),
			{ timeout: 90000 }
		);
		const total = performance.now() - started;
		clearInterval(timer);

		const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
		expect(Math.max(...gaps)).toBeLessThan(total / 4);
	}, 180000);
});
