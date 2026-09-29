import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ src, alt, onError }: { src: string; alt: string; onError: () => void }) => (
		<img data-testid="poster-img" src={src} alt={alt} onError={onError} />
	),
}));

import Poster from './poster';

describe('Poster component', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		global.fetch = fetchMock as any;
	});

	it('renders a deterministic poster URL for a given imdb id', async () => {
		render(<Poster imdbId="tt1234567" title="Demo" />);
		const img = await screen.findByTestId('poster-img');
		expect(img.getAttribute('src')).toContain('https://posters');
		expect(img.getAttribute('src')).toContain('tt1234567-small.jpg');
		expect(img).toHaveAttribute('alt', 'Poster for Demo');
	});

	it('falls back to metahub when the cdn image fails', async () => {
		render(<Poster imdbId="tt7654321" title="Fallback" />);
		const img = await screen.findByTestId('poster-img');

		fireEvent.error(img);

		await waitFor(() =>
			expect(img.getAttribute('src')).toBe(
				'https://images.metahub.space/poster/small/tt7654321/img'
			)
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('falls back to the poster API after metahub fails', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ url: 'https://api.example.com/fallback.jpg' }),
		});

		render(<Poster imdbId="tt7654321" title="Fallback" />);
		const img = await screen.findByTestId('poster-img');

		fireEvent.error(img); // cdn -> metahub
		await waitFor(() => expect(img.getAttribute('src')).toContain('images.metahub.space'));
		fireEvent.error(img); // metahub -> api

		await waitFor(() =>
			expect(img.getAttribute('src')).toBe('https://api.example.com/fallback.jpg')
		);
		expect(fetchMock).toHaveBeenCalledWith('/api/poster?imdbid=tt7654321');
	});

	// Production's /api/poster answered tt0234215 (The Matrix Reloaded) with an
	// m.media-amazon.com URL that itself 404s (2026-09-28). The card must still
	// end on the placeholder, not a broken image.
	it('uses the placeholder when the poster API returns a dead image URL', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					url: 'https://m.media-amazon.com/images/M/MV5BNzg5Yjg5OTctYTIxYy00MDQ0LWI5NjItYzQ4M2MyYTUxZjIyXkEyXkFqcGdeQXVyMTA2NDQwNjg2._V1_SX300.jpg',
				}),
		});

		render(<Poster imdbId="tt0234215" title="The Matrix Reloaded" />);
		const img = await screen.findByTestId('poster-img');

		fireEvent.error(img); // cdn -> metahub
		await waitFor(() => expect(img.getAttribute('src')).toContain('images.metahub.space'));
		fireEvent.error(img); // metahub -> api
		await waitFor(() => expect(img.getAttribute('src')).toContain('m.media-amazon.com'));
		fireEvent.error(img); // api url -> placeholder

		await waitFor(() => expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/));
	});

	// The API's answer is cached per title, and a second card for the same title
	// (search results re-render, a remount) starts from that cache. It used to
	// start there as if it were the last resort, so a dead cached URL left a
	// broken image with no fallback: /search?query=matrix at every viewport.
	it('still falls back when a remount starts from a dead cached API URL', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({ url: 'https://m.media-amazon.com/images/M/dead._V1_SX300.jpg' }),
		});

		const first = render(<Poster imdbId="tt9990001" title="Paranormal Matrix" />);
		let img = await screen.findByTestId('poster-img');
		fireEvent.error(img); // cdn -> metahub
		await waitFor(() => expect(img.getAttribute('src')).toContain('images.metahub.space'));
		fireEvent.error(img); // metahub -> api
		await waitFor(() => expect(img.getAttribute('src')).toContain('m.media-amazon.com'));
		first.unmount();

		render(<Poster imdbId="tt9990001" title="Paranormal Matrix" />);
		img = await screen.findByTestId('poster-img');
		await waitFor(() => expect(img.getAttribute('src')).toContain('m.media-amazon.com'));
		fireEvent.error(img);

		await waitFor(() => expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/));
	});

	// Recorded in Chrome on /person/christopher-nolan/movies (2026-09-29): the
	// metahub image reports its error twice. The second one landed while
	// /api/poster was still in flight and moved straight to the placeholder,
	// then the fetch resolved and swapped in a dead m.media-amazon.com URL
	// whose own error was then ignored, leaving a broken image.
	it('ends on the placeholder when a duplicate error races the poster API', async () => {
		let resolveApi: (value: unknown) => void = () => {};
		fetchMock.mockReturnValue(new Promise((resolve) => (resolveApi = resolve)));

		render(<Poster imdbId="tt2552826" title="Stanley Kubrick in Focus" />);
		const img = await screen.findByTestId('poster-img');

		fireEvent.error(img); // cdn -> metahub
		await waitFor(() => expect(img.getAttribute('src')).toContain('images.metahub.space'));
		fireEvent.error(img); // metahub -> api (fetch pending)
		fireEvent.error(img); // the duplicate metahub error
		resolveApi({
			ok: true,
			json: () =>
				Promise.resolve({
					url: 'https://m.media-amazon.com/images/M/MV5BZGVhZWVmMjMtNGQ5OS00ZWZhLWFiYjctNDlkZmE3NzQ3OWI0XkEyXkFqcGdeQXVyMjQ0NzE0MQ@@._V1_SX300.jpg',
				}),
		});
		await waitFor(() => expect(img.getAttribute('src')).toContain('m.media-amazon.com'));
		fireEvent.error(img); // the API's URL is dead too

		await waitFor(() => expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/));
	});

	it('uses an inline SVG placeholder when every remote source fails', async () => {
		fetchMock.mockResolvedValue({ ok: false });

		render(<Poster imdbId="tt0000001" title="Last Resort" />);
		const img = await screen.findByTestId('poster-img');

		fireEvent.error(img); // cdn -> metahub
		await waitFor(() => expect(img.getAttribute('src')).toContain('images.metahub.space'));
		fireEvent.error(img); // metahub -> api (404) -> placeholder

		await waitFor(() => expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/));
		expect(decodeURIComponent(img.getAttribute('src') || '')).toContain('Last Resort');
	});
});
