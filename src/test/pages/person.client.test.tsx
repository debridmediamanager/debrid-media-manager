import { render } from '@testing-library/react';
import { useRouter } from 'next/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();

vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));

describe('PersonPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReplace.mockReset();
	});

	it('should render nothing (returns null)', async () => {
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			replace: mockReplace,
			query: {},
			pathname: '/person/[personSlug]',
			asPath: '/person/test-person',
			isReady: false,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);

		const PersonPage = (await import('@/pages/person/[personSlug]')).default;
		const { container } = render(<PersonPage />);

		expect(container.innerHTML).toBe('');
	});

	it('should redirect to movies subpage when router is ready', async () => {
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			replace: mockReplace,
			query: { personSlug: 'john-doe' },
			pathname: '/person/[personSlug]',
			asPath: '/person/john-doe',
			isReady: true,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);

		const PersonPage = (await import('@/pages/person/[personSlug]')).default;
		render(<PersonPage />);

		expect(mockReplace).toHaveBeenCalledWith('/person/john-doe/movies');
	});

	it('should not redirect when personSlug is empty', async () => {
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			replace: mockReplace,
			query: {},
			pathname: '/person/[personSlug]',
			asPath: '/person/',
			isReady: true,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);

		const PersonPage = (await import('@/pages/person/[personSlug]')).default;
		render(<PersonPage />);

		expect(mockReplace).not.toHaveBeenCalled();
	});
});
