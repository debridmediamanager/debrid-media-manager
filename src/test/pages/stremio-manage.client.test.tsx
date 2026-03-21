import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { posterMock, toastMock, saveCastProfileMock } = vi.hoisted(() => ({
	posterMock: vi.fn(({ imdbId, title }: { imdbId: string; title: string }) => (
		<div data-testid={`poster-${imdbId}`}>{title}</div>
	)),
	toastMock: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
	}),
	saveCastProfileMock: vi.fn(),
}));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: posterMock,
}));

vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useRealDebridAccessToken: () => ['rd-token'],
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('lucide-react', () => ({
	__esModule: true,
	Eye: () => <svg data-testid="eye-icon" />,
	Trash2: () => <svg data-testid="trash-icon" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt, ...props }: any) => (
		<div aria-label={alt} data-testid={props['data-testid'] ?? 'mock-next-image'} {...props} />
	),
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children, ...props }: any) => (
		<a href={typeof href === 'string' ? href : String(href)} {...props}>
			{children}
		</a>
	),
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	Toaster: () => null,
}));

vi.mock('@/utils/castApiClient', () => ({
	__esModule: true,
	saveCastProfile: saveCastProfileMock,
}));

import { ManagePage } from '@/pages/stremio/manage';

describe('Stremio manage page poster integration', () => {
	let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

	beforeEach(() => {
		posterMock.mockClear();
		toastMock.mockClear();
		toastMock.success.mockClear();
		toastMock.error.mockClear();
		saveCastProfileMock.mockClear();

		window.localStorage.clear();
		window.localStorage.setItem('rd:clientId', JSON.stringify('client-id'));
		window.localStorage.setItem('rd:clientSecret', JSON.stringify('client-secret'));
		window.localStorage.setItem('rd:refreshToken', JSON.stringify('refresh-token'));
		window.localStorage.setItem('rd:accessToken', JSON.stringify('access-token'));

		fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();

			if (url.startsWith('/api/stremio/id')) {
				return new Response(JSON.stringify({ id: 'cast-token-abc123' }), { status: 200 });
			}

			if (url.startsWith('/api/stremio/links')) {
				return new Response(
					JSON.stringify([
						{
							imdbId: 'tt1234567:1:1',
							url: 'https://example.com/Example.Show.S01E01.1080p.mkv',
							hash: 'hash-1',
							size: 3072,
							updatedAt: new Date().toISOString(),
						},
						{
							imdbId: 'tt7654321',
							url: 'https://example.com/Example.Movie.2020.1080p.mkv',
							hash: 'hash-2',
							size: 6144,
							updatedAt: new Date().toISOString(),
						},
					]),
					{ status: 200 }
				);
			}

			if (url.startsWith('/api/info/show')) {
				return new Response(JSON.stringify({ title: 'Example Show' }), { status: 200 });
			}

			if (url.startsWith('/api/info/movie')) {
				return new Response(JSON.stringify({ title: 'Example Movie' }), { status: 200 });
			}

			return new Response('Not Found', { status: 404 });
		});

		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		window.localStorage.clear();
	});

	it('uses poster component with metadata-derived titles for each group', async () => {
		render(<ManagePage />);

		await waitFor(() => {
			expect(saveCastProfileMock).toHaveBeenCalledWith(
				'client-id',
				'client-secret',
				'refresh-token',
				0, // movieMaxSize default
				0, // episodeMaxSize default
				5, // otherStreamsLimit default
				false // hideCastOption default
			);
		});

		await waitFor(() => {
			const titles = posterMock.mock.calls.map(
				([props]) => (props as { title: string }).title
			);
			expect(titles).toContain('Example Show');
			expect(titles).toContain('Example Movie');
		});

		await waitFor(() =>
			expect(
				screen.getByRole('button', {
					name: /Toggle selection for show Example Show/i,
				})
			).toBeInTheDocument()
		);

		expect(fetchMock).toHaveBeenCalledWith('/api/info/show?imdbid=tt1234567');
		expect(fetchMock).toHaveBeenCalledWith('/api/info/movie?imdbid=tt7654321');
	});
});
