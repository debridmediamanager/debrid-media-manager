import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import tree from '../fixtures/hashlist/hashlists-tree-2026-11-14.json';

vi.mock('next/router', () => ({
	useRouter: vi.fn(() => ({
		push: vi.fn(),
		query: {},
		pathname: '/hashlists',
		asPath: '/hashlists',
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

describe('HashlistsPage', () => {
	let fetchSpy: Mock<(...args: Parameters<typeof fetch>) => any>;

	beforeEach(() => {
		fetchSpy = vi.fn<(...args: Parameters<typeof fetch>) => any>();
		global.fetch = fetchSpy;
		vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {});
	});

	it('should render the page title', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const HashlistsPage = (await import('@/pages/hashlists')).default;
		render(<HashlistsPage />);

		expect(screen.getByText('Hash Lists Browser')).toBeInTheDocument();
	});

	it('should show loading state initially', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const HashlistsPage = (await import('@/pages/hashlists')).default;
		render(<HashlistsPage />);

		expect(screen.getByText('Loading hashlists...')).toBeInTheDocument();
	});

	it('should show error state on fetch failure', async () => {
		fetchSpy.mockRejectedValue(new Error('Network error'));

		const HashlistsPage = (await import('@/pages/hashlists')).default;
		render(<HashlistsPage />);

		const errorMsg = await screen.findByText('Network error');
		expect(errorMsg).toBeInTheDocument();
	});

	it('should show no hashlists message when empty', async () => {
		fetchSpy.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ names: [] }),
		});

		const HashlistsPage = (await import('@/pages/hashlists')).default;
		render(<HashlistsPage />);

		const noHashlists = await screen.findByText('No hashlists found');
		expect(noHashlists).toBeInTheDocument();
	});

	it('should render navigation buttons', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const HashlistsPage = (await import('@/pages/hashlists')).default;
		render(<HashlistsPage />);

		const buttons = screen.getAllByRole('button');
		expect(buttons.length).toBe(3);
	});

	it('should render home link', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const HashlistsPage = (await import('@/pages/hashlists')).default;
		render(<HashlistsPage />);

		const homeLinks = screen
			.getAllByRole('link')
			.filter((el) => el.getAttribute('href') === '/');
		expect(homeLinks.length).toBeGreaterThan(0);
	});

	// GitHub's contents API answers with the first 1,000 entries and no more: on
	// 2026-11-14 it stopped at 0f6a0203-….html while the repo held 15,274 lists,
	// so Random and Next never left that first 1,000.
	it('picks from every list, not only the first 1,000', async () => {
		const RAW = 'https://raw.githubusercontent.com/debridmediamanager/hashlists/main/';
		const pages = tree.tree
			.filter((e) => e.type === 'blob' && e.path.endsWith('.html') && e.path !== 'index.html')
			.map((e) => e.path);
		const contents = tree.tree
			.slice(0, 1000)
			.map((e) => ({ name: e.path, download_url: `${RAW}${e.path}` }));
		fetchSpy.mockImplementation(async (url) => {
			if (url === 'https://api.github.com/repos/debridmediamanager/hashlists/contents')
				return { ok: true, json: async () => contents };
			if (url === '/api/hashlists/names')
				return { ok: true, json: async () => ({ names: pages }) };
			return new Promise(() => {});
		});
		const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);

		const HashlistsPage = (await import('@/pages/hashlists')).default;
		render(<HashlistsPage />);

		const last = pages[Math.floor(0.999 * pages.length)];
		await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(`${RAW}${last}`));
		expect(pages.indexOf(last)).toBeGreaterThanOrEqual(1000);
		random.mockRestore();
	});
});
