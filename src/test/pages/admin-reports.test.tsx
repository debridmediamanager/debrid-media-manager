import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/admin/reports' }) }));
vi.mock('next/head', () => ({
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/poster', () => ({
	default: ({ imdbId, title }: { imdbId: string; title?: string }) => (
		<img alt={`Poster for ${title}`} data-imdb={imdbId} />
	),
}));

import ReportsAdminPage from '@/pages/admin/reports';

const report = (over: Record<string, unknown> = {}) => ({
	imdbId: 'tt1254207',
	hash: 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
	title: 'Big Buck Bunny',
	year: 2008,
	kind: 'movie',
	filename: 'Big.Buck.Bunny.2008.1080p.mkv',
	types: ['wrong_imdb'],
	reporters: 1,
	model: null,
	lastReportedAt: '2026-11-11T09:00:00.000Z',
	decision: null,
	note: null,
	decidedAt: null,
	...over,
});

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('/admin/reports', () => {
	it('shows each report with its poster and a link to the title page', async () => {
		localStorage.setItem('dmm:adminToken', 'token');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							total: 2,
							counts: { all: 2, agrees: 0, disagrees: 0, unjudged: 2 },
							items: [
								report(),
								report({
									imdbId: 'tt0903747',
									title: 'Breaking Bad',
									year: 2008,
									kind: 'show',
								}),
							],
						})
					)
			)
		);
		render(<ReportsAdminPage />);

		const poster = await screen.findByAltText('Poster for Big Buck Bunny');
		expect(poster.getAttribute('data-imdb')).toBe('tt1254207');
		expect(
			screen.getByRole('link', { name: 'Big Buck Bunny (2008)' }).getAttribute('href')
		).toBe('/movie/tt1254207');
		expect(screen.getByRole('link', { name: 'Breaking Bad (2008)' }).getAttribute('href')).toBe(
			'/show/tt0903747'
		);
	});
});
