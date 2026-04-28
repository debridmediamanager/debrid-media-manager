import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/hooks/torboxCastToken', () => ({
	useTorBoxCastToken: vi.fn(),
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

describe('TorBoxManagePage', () => {
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		fetchSpy = vi.fn();
		global.fetch = fetchSpy;
	});

	it('should show loading state when no api key', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue([null, vi.fn()]);

		const { TorBoxManagePage } = await import('@/pages/stremio-torbox/manage');
		render(<TorBoxManagePage />);

		expect(screen.getByText('Debrid Media Manager is loading...')).toBeInTheDocument();
	});

	it('should show loading text while fetching links', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const { TorBoxManagePage } = await import('@/pages/stremio-torbox/manage');
		render(<TorBoxManagePage />);

		expect(screen.getByText('Loading...')).toBeInTheDocument();
	});

	it('should render page title', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const { TorBoxManagePage } = await import('@/pages/stremio-torbox/manage');
		render(<TorBoxManagePage />);

		expect(screen.getByText('DMM Cast TorBox - Manage Casted Links')).toBeInTheDocument();
	});

	it('should show no links message when empty', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ links: [] }),
		});

		const { TorBoxManagePage } = await import('@/pages/stremio-torbox/manage');
		render(<TorBoxManagePage />);

		const noLinks = await screen.findByText('No casted links found');
		expect(noLinks).toBeInTheDocument();
	});

	it('should render back link to stremio-torbox', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ links: [] }),
		});

		const { TorBoxManagePage } = await import('@/pages/stremio-torbox/manage');
		render(<TorBoxManagePage />);

		const backLink = await screen.findByText('Back to Stremio TorBox');
		expect(backLink).toHaveAttribute('href', '/stremio-torbox');
	});

	it('should render grouped links', async () => {
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue(['test-api-key', vi.fn()]);
		fetchSpy.mockImplementation((url: string) => {
			if (url.includes('/api/stremio-tb/links')) {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							links: [
								{
									imdbId: 'tt7777777',
									url: 'https://example.com/show.mkv',
									hash: 'def456',
									size: 4096,
									updatedAt: new Date().toISOString(),
								},
							],
						}),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ title: 'Test Show' }),
			});
		});

		const { TorBoxManagePage } = await import('@/pages/stremio-torbox/manage');
		render(<TorBoxManagePage />);

		const selectAll = await screen.findByText('Select All');
		expect(selectAll).toBeInTheDocument();
		expect(screen.getByText('show.mkv')).toBeInTheDocument();
	});
});
