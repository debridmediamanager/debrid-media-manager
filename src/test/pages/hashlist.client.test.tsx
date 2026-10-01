import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	useRealDebridAccessToken: vi.fn(() => [null, false, false]),
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
	default: vi.fn().mockImplementation(() => ({
		initializeDB: vi.fn().mockResolvedValue(undefined),
		all: vi.fn().mockResolvedValue([]),
		hashes: vi.fn().mockResolvedValue(new Set()),
		addAll: vi.fn().mockResolvedValue(undefined),
		getAllByHash: vi.fn().mockResolvedValue([]),
		deleteByHash: vi.fn().mockResolvedValue(undefined),
	})),
}));

vi.mock('lz-string', () => ({
	__esModule: true,
	default: {
		decompressFromEncodedURIComponent: vi.fn(() => '[]'),
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

describe('HashlistPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(window, 'location', {
			writable: true,
			value: { hash: '', reload: vi.fn() },
		});
		vi.spyOn(window.sessionStorage.__proto__, 'getItem').mockReturnValue(null);
		vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {});
		vi.spyOn(window.sessionStorage.__proto__, 'removeItem').mockImplementation(() => {});
	});

	it('should render the page with title and Go Home link', async () => {
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		expect(screen.getByText('Go Home')).toBeInTheDocument();
		const homeLink = screen.getByText('Go Home');
		expect(homeLink).toHaveAttribute('href', '/');
	});

	it('should render search input', async () => {
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		const searchInput = screen.getByPlaceholderText(
			'quick search on filename, hash, or id; supports regex'
		);
		expect(searchInput).toBeInTheDocument();
	});

	it('should render movie and TV count links', async () => {
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		expect(screen.getByText('0 Movies')).toBeInTheDocument();
		expect(screen.getByText('0 TV Shows')).toBeInTheDocument();
	});

	it('should render table headers', async () => {
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		expect(screen.getByText('Title')).toBeInTheDocument();
		expect(screen.getByText('Size')).toBeInTheDocument();
		expect(screen.getByText('Actions')).toBeInTheDocument();
	});

	it('should show login prompt when no debrid keys', async () => {
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		expect(screen.getByText('Login to RD/AD/TB/PM/OC/DL to download')).toBeInTheDocument();
	});

	it('offers the Offcloud bulk download once an Offcloud key is present', async () => {
		const { useOffcloudApiKey } = await import('@/hooks/auth');
		vi.mocked(useOffcloudApiKey).mockReturnValue('oc-key');

		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		expect(screen.getByText('OC Download (0)')).toBeInTheDocument();
		expect(
			screen.queryByText('Login to RD/AD/TB/PM/OC/DL to download')
		).not.toBeInTheDocument();

		vi.mocked(useOffcloudApiKey).mockReturnValue(null);
	});

	it('offers the Debrid-Link bulk download once a Debrid-Link credential is present', async () => {
		const { useDebridLinkCredential } = await import('@/hooks/auth');
		vi.mocked(useDebridLinkCredential).mockReturnValue('dl-token');

		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		expect(screen.getByText('DL Download (0)')).toBeInTheDocument();
		expect(
			screen.queryByText('Login to RD/AD/TB/PM/OC/DL to download')
		).not.toBeInTheDocument();

		vi.mocked(useDebridLinkCredential).mockReturnValue(null);
	});

	// /hashlist opened without a #fragment (a bookmark, or the nav link) has no
	// list to read. It used to JSON.parse('') and toast a fetch failure.
	it('does not report a failure when the URL carries no hashlist', async () => {
		const { toast } = await import('react-hot-toast');
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		// initialize() awaits the DB and then reads the list; let it finish.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(toast.error).not.toHaveBeenCalled();
		expect(screen.getByText('0 Movies')).toBeInTheDocument();
	});

	// A real shared list from /hashlists (2026-09-29) is titled with one unbroken
	// release-style token. At 320px the heading kept that token's width and pushed
	// "Go Home" to 364px, scrolling the page sideways.
	it('lets a long unbroken list title wrap beside Go Home', async () => {
		const lzString = (await import('lz-string')).default;
		vi.mocked(lzString.decompressFromEncodedURIComponent).mockReturnValue(
			JSON.stringify({ title: 'ENG.GER.WEBDL.REMUX.2160P', torrents: [] })
		);
		window.location.hash = '#list';
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		const heading = await screen.findByRole('heading', {
			level: 1,
			name: /ENG\.GER\.WEBDL\.REMUX\.2160P/,
		});
		expect(heading).toHaveClass('min-w-0', 'break-words');
		expect(screen.getByText('Go Home')).toHaveClass('shrink-0');
		vi.mocked(lzString.decompressFromEncodedURIComponent).mockReturnValue('[]');
	});

	it('should render pagination controls', async () => {
		const HashlistPage = (await import('@/pages/hashlist')).default;
		render(<HashlistPage />);

		const paginationElements = screen.getAllByText('1/1');
		expect(paginationElements.length).toBeGreaterThanOrEqual(1);
	});
});
