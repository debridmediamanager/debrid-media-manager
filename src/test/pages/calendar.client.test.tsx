import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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
	let fetchSpy: Mock<(...args: Parameters<typeof fetch>) => any>;

	beforeEach(() => {
		fetchSpy = vi.fn<(...args: Parameters<typeof fetch>) => any>();
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

// Calendar days used to be parsed and computed in UTC: new Date('2026-10-25') is
// UTC midnight, which Chicago formats as Oct 24, and toISOString() turned a
// Saturday evening there into Sunday. Every label read a day early and "Today"
// sat on tomorrow's column all evening in the Americas.
describe('CalendarPage west of UTC', () => {
	const originalTz = process.env.TZ;

	beforeEach(() => {
		process.env.TZ = 'America/Chicago';
		vi.useFakeTimers({ toFake: ['Date'] });
		// Saturday 2026-10-24, 10 PM in Chicago; already Sunday 03:00 in UTC.
		vi.setSystemTime(new Date('2026-10-25T03:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
		process.env.TZ = originalTz;
	});

	const episode = (title: string, firstAired: string) => ({
		title,
		season: 1,
		episode: 1,
		firstAired,
		isPremiere: false,
		ids: { imdb: `tt-${title}` },
		network: 'HBO',
	});

	it('labels days and today by the local date', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					range: { start: '2026-10-17', days: 14 },
					days: [
						{
							date: '2026-10-24',
							items: [episode('Afternoon', '2026-10-24T19:00:00Z')],
						},
						// 8 PM Chicago on the 24th, filed under the 25th by the UTC API
						{ date: '2026-10-25', items: [episode('Evening', '2026-10-25T01:00:00Z')] },
						{ date: '2026-10-26', items: [episode('Monday', '2026-10-26T18:00:00Z')] },
					],
					tmdb: { airingToday: [], onTheAir: [] },
				}),
		}) as any;

		const CalendarPage = (await import('@/pages/calendar')).default;
		render(<CalendarPage />);

		const headings = (await screen.findAllByRole('heading', { level: 3 })).map(
			(h) => h.textContent
		);
		expect(headings).toEqual(['Sat, Oct 24', 'Sun, Oct 25', 'Mon, Oct 26']);

		const todayColumn = screen.getAllByText('Afternoon')[0].closest('section')!;
		expect(todayColumn.textContent).toContain('Today');
		expect(todayColumn.textContent).toContain('Evening');
		expect(screen.getAllByText('Monday')[0].closest('section')!.textContent).not.toContain(
			'Today'
		);
		expect(screen.getByText(/Oct 17 - .*Oct 30/)).toBeInTheDocument();
	});
});
