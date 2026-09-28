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

describe('PersonMoviesPage responsive content', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			query: { personSlug: 'christopher-nolan' },
			pathname: '/person/[personSlug]/movies',
			asPath: '/person/christopher-nolan/movies',
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

	it('allows a long real credit title to wrap inside its narrow card', async () => {
		const PersonMoviesPage = (await import('@/pages/person/[personSlug]/movies')).default;
		render(<PersonMoviesPage />);

		const title = screen
			.getAllByText(longTitleCredits[0].title)
			.find((element) => element.classList.contains('text-sm'));
		expect(title).toHaveClass('break-words');
	});
});
