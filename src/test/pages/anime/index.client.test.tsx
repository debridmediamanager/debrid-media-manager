import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('react-hot-toast', () => ({ Toaster: () => null }));
vi.mock('@/utils/withAuth', () => ({ withAuth: (c: unknown) => c }));
vi.mock('@/hooks/useCachedList', () => ({
	useCachedList: () => ({
		loading: false,
		error: null,
		data: [
			{
				anidb_id: 17617,
				mal_id: null,
				title: 'Frieren',
				type: 'TV',
				poster_url: 'https://x/f.jpg',
			},
			{
				anidb_id: null,
				mal_id: 52991,
				title: 'Mal only',
				type: 'ONA',
				poster_url: 'https://x/m.jpg',
			},
		],
	}),
}));

import { AnimeHome } from '@/pages/anime/index';

describe('anime home page', () => {
	it('links each entry to its anime page', () => {
		render(<AnimeHome />);
		expect(screen.getByRole('link', { name: /Frieren/ }).getAttribute('href')).toBe(
			'/anime/17617'
		);
		expect(screen.getByRole('link', { name: /Mal only/ }).getAttribute('href')).toBe(
			'/anime/mal-52991'
		);
	});
});
