import longTitleCredits from '@/test/fixtures/responsive/person-credits-long-title.json';
import { render, screen } from '@testing-library/react';
import { useRouter } from 'next/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useCachedListMock } = vi.hoisted(() => ({
	useCachedListMock: vi.fn(),
}));

vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));

vi.mock('@/hooks/useCachedList', () => ({
	useCachedList: useCachedListMock,
}));

vi.mock('@/components/poster', () => ({
	default: ({ title }: { title?: string }) => <div data-testid="poster">{title}</div>,
}));

// The shows grid is the movies grid's twin; the same real long-title credit
// (one unbroken 51-letter word) pushed its card past a 320px column.
describe('PersonShowsPage responsive content', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			query: { personSlug: 'christopher-nolan' },
			pathname: '/person/[personSlug]/shows',
			asPath: '/person/christopher-nolan/shows',
			isReady: true,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);
		useCachedListMock.mockReturnValue({
			data: longTitleCredits,
			loading: false,
			error: null,
			refetch: vi.fn(),
			reset: vi.fn(),
		});
	});

	it('allows a long unbroken credit title to wrap inside its narrow card, as on the movies page', async () => {
		const PersonShowsPage = (await import('@/pages/person/[personSlug]/shows')).default;
		render(<PersonShowsPage />);

		const title = screen
			.getAllByText(longTitleCredits[0].title)
			.find((element) => element.classList.contains('text-sm'));
		expect(title).toHaveClass('break-words');
		expect(screen.getByText('as The Hen')).toHaveClass('text-gray-400');
	});
});
