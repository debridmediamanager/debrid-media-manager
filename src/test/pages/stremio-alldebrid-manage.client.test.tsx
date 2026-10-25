import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...props
	}: {
		children: ReactNode;
		href: string;
		[key: string]: any;
	}) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt, ...props }: any) => (
		<span data-testid="mock-image" {...props}>
			{alt}
		</span>
	),
}));

vi.mock('@/hooks/allDebridCastToken', () => ({
	useAllDebridCastToken: vi.fn(),
}));

vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: vi.fn(),
}));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ title }: { title: string }) => <div data-testid="poster">{title}</div>,
}));

vi.mock('@/utils/withAuth', () => ({
	withAuth: (Component: any) => Component,
}));

vi.mock('react-hot-toast', () => ({
	toast: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
	}),
	Toaster: () => null,
}));

vi.mock('parse-torrent-title', () => ({
	__esModule: true,
	default: { parse: vi.fn(() => ({ title: 'Test', season: undefined, episode: undefined })) },
}));

describe('AllDebridManagePage', () => {
	let fetchSpy: Mock<(...args: Parameters<typeof fetch>) => any>;

	beforeEach(() => {
		vi.clearAllMocks();
		fetchSpy = vi.fn<(...args: Parameters<typeof fetch>) => any>();
		global.fetch = fetchSpy;
	});

	it('asks for an AllDebrid login when there is no api key', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue([null, vi.fn()]);

		const { AllDebridManagePage } = await import('@/pages/stremio-alldebrid/manage');
		render(<AllDebridManagePage />);

		expect(screen.getByText('AllDebrid Required')).toBeInTheDocument();
		expect(screen.getByText('Login with AllDebrid').closest('a')).toHaveAttribute(
			'href',
			'/alldebrid/login?redirect=%2Fstremio-alldebrid%2Fmanage'
		);
	});

	it('should show loading text while fetching links', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const { AllDebridManagePage } = await import('@/pages/stremio-alldebrid/manage');
		render(<AllDebridManagePage />);

		expect(screen.getByText('Loading...')).toBeInTheDocument();
	});

	it('should render page title', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const { AllDebridManagePage } = await import('@/pages/stremio-alldebrid/manage');
		render(<AllDebridManagePage />);

		expect(screen.getByRole('heading', { name: 'Casted links' })).toBeInTheDocument();
	});

	it('should show no links message when empty', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ links: [] }),
		});

		const { AllDebridManagePage } = await import('@/pages/stremio-alldebrid/manage');
		render(<AllDebridManagePage />);

		const noLinks = await screen.findByText('No casted links found');
		expect(noLinks).toBeInTheDocument();
	});

	it('should render back link to stremio-alldebrid', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ links: [] }),
		});

		const { AllDebridManagePage } = await import('@/pages/stremio-alldebrid/manage');
		render(<AllDebridManagePage />);

		const backLink = await screen.findByText('Back to Stremio AllDebrid');
		expect(backLink).toHaveAttribute('href', '/stremio-alldebrid');
	});

	it('should render grouped links', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockImplementation((input) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url.includes('/api/stremio-ad/links')) {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							links: [
								{
									imdbId: 'tt1234567',
									url: 'https://example.com/movie.mkv',
									hash: 'abc123',
									size: 2048,
									updatedAt: new Date().toISOString(),
								},
							],
						}),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ title: 'Test Movie' }),
			});
		});

		const { AllDebridManagePage } = await import('@/pages/stremio-alldebrid/manage');
		render(<AllDebridManagePage />);

		// One file: the card's thumbnail is the only select-all, and the size
		// follows the filename on the same line.
		expect(await screen.findByText('movie.mkv')).toBeInTheDocument();
		expect(screen.getByText('· 2.00 GB')).toBeInTheDocument();
		expect(screen.queryByText('Select All')).not.toBeInTheDocument();
	});
});
