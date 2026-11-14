// A copy served anywhere but debridmediamanager.com (jsdom's default is localhost).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ src, alt, onError }: { src: string; alt: string; onError: () => void }) => (
		<img data-testid="poster-img" src={src} alt={alt} onError={onError} />
	),
}));

import Poster from './poster';

describe('Poster on a self-hosted copy', () => {
	it('never asks DMM’s poster cache: Metahub first, then the poster API', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ url: 'https://image.tmdb.org/t/p/w300/x.jpg' }),
		});
		global.fetch = fetchMock as any;

		render(<Poster imdbId="tt2222222" title="Own copy" />);
		const img = await screen.findByTestId('poster-img');
		expect(img.getAttribute('src')).toBe(
			'https://images.metahub.space/poster/small/tt2222222/img'
		);

		fireEvent.error(img);
		await waitFor(() =>
			expect(img.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w300/x.jpg')
		);
		expect(fetchMock).toHaveBeenCalledWith('/api/poster?imdbid=tt2222222');
	});
});
