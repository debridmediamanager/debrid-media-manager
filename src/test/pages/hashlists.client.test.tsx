import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchSpy = vi.fn();
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
			json: () => Promise.resolve([{ name: 'index.html', download_url: '' }]),
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
});
