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
	checkPlayableAvailabilityRd: vi.fn().mockResolvedValue(0),
	wrapLoading: (_service: string, p: Promise<number>) => p,
}));

// Real-Debrid answered every add from this list (a real shared list) with
// 451 {"error":"infringing_file","error_code":35} on 2026-10-22, and
// handleAddAsMagnetInRd turns that into 'infringing_file' rather than a throw.
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

		fireEvent.click(await screen.findByText('Show All'));
		const button = await screen.findByRole('button', { name: /^RD Download \([1-9]\d*\)$/ });
		const count = Number(button.textContent!.match(/\((\d+)\)/)![1]);
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
	});
});
