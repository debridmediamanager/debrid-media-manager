import { ModalProvider } from '@/components/modals/ModalContext';
import { handleAddAsMagnetInPm } from '@/utils/addMagnet';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import list from '../fixtures/hashlist/fe6e0436-b0c4-4163-9fbd-86a25a274396.json';

// A Premiumize-only session on a real shared list (the same list as hashlist.bulkRd).

vi.mock('@/utils/libraryIdentify', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/libraryIdentify')>()),
	identifyLibrary: vi.fn(async () => {}),
}));

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
	useRealDebridAccessToken: vi.fn(() => [null, false, false]),
	useAllDebridApiKey: vi.fn(() => null),
	useTorBoxAccessToken: vi.fn(() => null),
	usePremiumizeCredential: vi.fn(() => 'pm-key'),
	useOffcloudApiKey: vi.fn(() => null),
	useDebridLinkCredential: vi.fn(() => null),
	usePutioAccessToken: vi.fn(() => null),
}));

vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: vi.fn(() => ({ addTorrent: vi.fn(), removeTorrent: vi.fn() })),
}));

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return {
			initializeDB: vi.fn().mockResolvedValue(undefined),
			all: vi.fn().mockResolvedValue([]),
			hashes: vi.fn().mockResolvedValue(new Set()),
			addAll: vi.fn().mockResolvedValue(undefined),
			getAllByHash: vi.fn().mockResolvedValue([]),
			deleteByHash: vi.fn().mockResolvedValue(undefined),
		};
	}),
}));

vi.mock('lz-string', () => ({
	__esModule: true,
	default: { decompressFromEncodedURIComponent: vi.fn(() => JSON.stringify(list)) },
}));

vi.mock('react-hot-toast', () => ({
	toast: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
		loading: vi.fn(),
		custom: vi.fn(),
		dismiss: vi.fn(),
	}),
	Toaster: () => null,
}));

vi.mock('@/utils/takedownClient', () => ({
	fetchBlockedHashes: vi.fn().mockResolvedValue(new Set()),
}));

// Premiumize has every other release cached.
vi.mock('@/utils/instantChecks', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/instantChecks')>()),
	checkAvailabilityPm2: vi.fn(async (_key, hashes: string[], setList) => {
		setList((rows: { hash: string; pmAvailable: boolean }[]) =>
			rows.map((row, index) => ({ ...row, pmAvailable: index % 2 === 0 }))
		);
		return Math.ceil(hashes.length / 2);
	}),
	wrapLoading: (_service: string, p: Promise<number>) => p,
}));

vi.mock('@/utils/addMagnet', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/addMagnet')>()),
	handleAddAsMagnetInPm: vi.fn().mockResolvedValue(undefined),
}));

const cached = list.torrents.filter((_, index) => index % 2 === 0).length;

async function renderPage() {
	const HashlistPage = (await import('@/pages/hashlist')).default;
	render(
		<ModalProvider>
			<HashlistPage />
		</ModalProvider>
	);
}

describe('HashlistPage with a Premiumize key', () => {
	beforeEach(() => {
		vi.mocked(handleAddAsMagnetInPm).mockClear();
		Object.defineProperty(window, 'location', {
			writable: true,
			value: { hash: '#list', reload: vi.fn() },
		});
	});

	// One click used to add the whole list: on 2026-11-14 a misclick on
	// "PM Download (117)" next to "One per title" started 117 transfers.
	it('asks before a bulk download and adds nothing when cancelled', async () => {
		await renderPage();

		fireEvent.click(await screen.findByRole('button', { name: `PM Download (${cached})` }));
		expect(
			await screen.findByText(`Add ${cached} releases to Premiumize?`)
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		await waitFor(() =>
			expect(screen.queryByText(/releases to Premiumize\?/)).not.toBeInTheDocument()
		);
		expect(handleAddAsMagnetInPm).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: `PM Download (${cached})` }));
		fireEvent.click(await screen.findByRole('button', { name: `Add ${cached}` }));
		await waitFor(() => expect(handleAddAsMagnetInPm).toHaveBeenCalledTimes(cached));
	});

	// The cached-only filter hides what Premiumize does not have, but its toggle
	// showed only with an RD, AD or TorBox key: the rest of the list was unreachable.
	it('offers Show All, which lists what Premiumize does not have', async () => {
		await renderPage();

		await screen.findByRole('button', { name: `PM Download (${cached})` });
		fireEvent.click(screen.getByRole('button', { name: 'Show All' }));

		expect(
			await screen.findByRole('button', { name: `PM Download (${list.torrents.length})` })
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show Instant' })).toBeInTheDocument();
	});
});
