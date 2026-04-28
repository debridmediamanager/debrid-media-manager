import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ title }: { title: string }) => <div data-testid="poster">{title}</div>,
}));

vi.mock('react-window', () => ({
	List: ({ children }: any) => <div data-testid="virtual-list">{children}</div>,
}));

describe('CalendarPage', () => {
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchSpy = vi.fn();
		global.fetch = fetchSpy;
	});

	it('should show loading spinner initially', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const CalendarPage = (await import('@/pages/calendar')).default;
		render(<CalendarPage />);

		const spinner = document.querySelector('.animate-spin');
		expect(spinner).toBeInTheDocument();
	});

	it('should render the page title and header', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const CalendarPage = (await import('@/pages/calendar')).default;
		render(<CalendarPage />);

		expect(screen.getByText('Episode Calendar')).toBeInTheDocument();
		expect(screen.getByText('Jump to Today')).toBeInTheDocument();
		expect(screen.getByText('Go Home')).toBeInTheDocument();
	});

	it('should render search input', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const CalendarPage = (await import('@/pages/calendar')).default;
		render(<CalendarPage />);

		const searchInput = screen.getByPlaceholderText(
			'Search title, network, S01E01, or IMDB id (regex ok)'
		);
		expect(searchInput).toBeInTheDocument();
	});

	it('should show error message on fetch failure', async () => {
		fetchSpy.mockResolvedValue({ ok: false });

		const CalendarPage = (await import('@/pages/calendar')).default;
		render(<CalendarPage />);

		const errorMessage = await screen.findByText('Could not load calendar data.');
		expect(errorMessage).toBeInTheDocument();
	});

	it('should show empty state when no episodes', async () => {
		fetchSpy.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					range: { start: '2024-01-01', days: 14 },
					days: [],
					tmdb: { airingToday: [], onTheAir: [] },
				}),
		});

		const CalendarPage = (await import('@/pages/calendar')).default;
		render(<CalendarPage />);

		const emptyMessage = await screen.findByText('No episodes scheduled in this window.');
		expect(emptyMessage).toBeInTheDocument();
	});

	it('should have Go Home link pointing to root', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const CalendarPage = (await import('@/pages/calendar')).default;
		render(<CalendarPage />);

		const homeLink = screen.getByText('Go Home');
		expect(homeLink).toHaveAttribute('href', '/');
	});

	it('should render mobile Today button', async () => {
		fetchSpy.mockReturnValue(new Promise(() => {}));

		const CalendarPage = (await import('@/pages/calendar')).default;
		render(<CalendarPage />);

		const todayButtons = screen.getAllByText('Today');
		expect(todayButtons.length).toBeGreaterThanOrEqual(1);
	});
});
