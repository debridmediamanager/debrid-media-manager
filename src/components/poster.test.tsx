import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
