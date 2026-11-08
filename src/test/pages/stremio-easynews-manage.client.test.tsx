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

vi.mock('@/hooks/easynewsCastToken', () => ({ useEasynewsCastToken: vi.fn() }));

vi.mock('@/hooks/localStorage', () => ({ __esModule: true, default: vi.fn() }));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ title }: { title: string }) => <div data-testid="poster">{title}</div>,
}));

vi.mock('@/utils/withAuth', () => ({ withAuth: (Component: any) => Component }));

vi.mock('react-hot-toast', () => ({
	toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
	Toaster: () => null,
}));

const link = (imdbId: string, hash: string) => ({
	imdbId,
	url: `Sintel ${hash}.mkv`,
	hash,
	size: 650,
	updatedAt: new Date().toISOString(),
});

describe('EasynewsManagePage', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		const useLocalStorage = (await import('@/hooks/localStorage')).default;
		vi.mocked(useLocalStorage).mockReturnValue([{ username: 'you', password: 'pw' }, vi.fn()]);
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/stremio-en/links')) {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							links: [link('tt1727587', 'a1'), link('tt0903747:2:3', 'b2')],
						}),
				});
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ title: 'A title' }) });
		}) as any;
	});

	// An Easynews cast is a file from the title's Usenet tab: "Cast other torrents" sent members
	// to the Torrents tab, where nothing casts to Easynews.
	it('sends "Cast other files" to the Usenet tab of the film or the cast season', async () => {
		const { EasynewsManagePage } = await import('@/pages/stremio-easynews/manage');
		render(<EasynewsManagePage />);

		const links = await screen.findAllByText('Cast other files');
		expect(links.map((a) => a.getAttribute('href')).sort()).toEqual([
			'/movie/tt1727587/usenet',
			'/show/tt0903747/2/usenet',
		]);
		expect(screen.queryByText('Cast other torrents')).not.toBeInTheDocument();
	});
});
