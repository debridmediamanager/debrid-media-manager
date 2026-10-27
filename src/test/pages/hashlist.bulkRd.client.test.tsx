import { handleAddAsMagnetInRd } from '@/utils/addMagnet';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import list from '../fixtures/hashlist/fe6e0436-b0c4-4163-9fbd-86a25a274396.json';

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
	default: ({
		children,
		href,
		className,
	}: {
		children: ReactNode;
		href: string;
		className?: string;
	}) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
}));

vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: vi.fn(() => ['rd-key', false, false]),
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
	})),
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
	default: {
		decompressFromEncodedURIComponent: vi.fn(() => JSON.stringify(list)),
	},
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

vi.mock('@/utils/token', () => ({
	generateTokenAndHash: vi.fn().mockResolvedValue(['problem', 'solution']),
}));

vi.mock('@/utils/instantChecks', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/instantChecks')>()),
	checkPlayableAvailabilityRd: vi.fn(async (_token, _solution, _hashes, setList) => {
		setList((rows: { hash: string; rdAvailable: boolean }[]) =>
			rows.map((row, index) => ({ ...row, rdAvailable: index % 2 === 0 }))
		);
		return Math.ceil(_hashes.length / 2);
	}),
	wrapLoading: (_service: string, p: Promise<number>) => p,
}));

// Real-Debrid answered every add from this list (a real shared list) with
// 451 {"error":"infringing_file","error_code":35} on 2026-10-22, and
// handleAddAsMagnetInRd turns that into 'infringing_file' rather than a throw.
// The bulk download is spaced a minute per add; record the gaps, do not wait them
const { delayMock } = vi.hoisted(() => ({ delayMock: vi.fn(async (_ms: number) => {}) }));
vi.mock('@/utils/delay', () => ({ delay: delayMock }));

vi.mock('@/utils/addMagnet', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/addMagnet')>()),
	handleAddAsMagnetInRd: vi.fn().mockResolvedValue('infringing_file'),
}));

describe('HashlistPage RD Download', () => {
	beforeEach(() => {
		Object.defineProperty(window, 'location', {
			writable: true,
			value: { hash: '#list', reload: vi.fn() },
		});
	});

	it('reports refused adds as failures, not started downloads (card 455)', async () => {
		const { toast } = await import('react-hot-toast');
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		const allButton = await screen.findByText('Show All');
		fireEvent.click(allButton);
		const button = await screen.findByRole('button', { name: /^RD Download \([1-9]\d*\)$/ });
		const available = list.torrents.filter((_, index) => index % 2 === 0);
		const count = available.length;
		expect(button).toHaveTextContent(`RD Download (${count})`);
		fireEvent.click(button);

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				`Failed to download ${count} torrents.`,
				expect.anything()
			)
		);
		expect(toast.success).not.toHaveBeenCalledWith(
			expect.stringMatching(/^Started/),
			expect.anything()
		);
		expect(
			vi
				.mocked(handleAddAsMagnetInRd)
				.mock.calls.map((call) => call[1])
				.sort()
		).toEqual(available.map((row) => row.hash).sort());
		// One at a time, a minute apart: RD pauses an account's adds after about
		// four in three minutes (#348); this ran four at once with no gap
		expect(delayMock.mock.calls.filter(([ms]) => ms === 60_000)).toHaveLength(count - 1);
	});
});
