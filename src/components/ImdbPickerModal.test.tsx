import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImdbPickerModal from './ImdbPickerModal';

const getMock = vi.fn();
vi.mock('axios', () => ({
	default: { get: (...args: any[]) => getMock(...args) },
}));

vi.mock('./poster', () => ({
	default: () => <div data-testid="poster" />,
}));

const movieResult = {
	type: 'movie',
	score: 1,
	movie: { title: 'Sinners', year: 2025, ids: { imdb: 'tt31193180', trakt: 1 } },
};
const showResult = {
	type: 'show',
	score: 1,
	show: { title: 'Severance', year: 2022, ids: { imdb: 'tt11280740', trakt: 2 } },
};

afterEach(() => {
	cleanup();
	getMock.mockReset();
});

describe('ImdbPickerModal', () => {
	it('renders nothing when closed', () => {
		const { container } = render(
			<ImdbPickerModal open={false} onPick={vi.fn()} onClose={vi.fn()} />
		);
		expect(container).toBeEmptyDOMElement();
	});

	it('searches the initial query and picks a movie with movie mediaType', async () => {
		getMock.mockResolvedValue({ data: [movieResult, showResult] });
		const onPick = vi.fn();
		render(<ImdbPickerModal open initialQuery="Sinners" onPick={onPick} onClose={vi.fn()} />);

		const row = await screen.findByText('Sinners');
		await waitFor(() =>
			expect(getMock).toHaveBeenCalledWith(expect.stringContaining('query=Sinners'))
		);
		await userEvent.click(row);
		expect(onPick).toHaveBeenCalledWith(
			expect.objectContaining({ imdbId: 'tt31193180', mediaType: 'movie', title: 'Sinners' })
		);
	});

	it('maps a show result to tv mediaType', async () => {
		getMock.mockResolvedValue({ data: [showResult] });
		const onPick = vi.fn();
		render(<ImdbPickerModal open initialQuery="Severance" onPick={onPick} onClose={vi.fn()} />);

		await userEvent.click(await screen.findByText('Severance'));
		expect(onPick).toHaveBeenCalledWith(
			expect.objectContaining({ imdbId: 'tt11280740', mediaType: 'tv' })
		);
	});

	it('accepts a pasted imdb id without a search', async () => {
		getMock.mockResolvedValue({ data: [] });
		const onPick = vi.fn();
		render(<ImdbPickerModal open initialQuery="tt1234567" onPick={onPick} onClose={vi.fn()} />);

		const useIdBtn = await screen.findByRole('button', { name: /Use IMDB id/i });
		await userEvent.click(useIdBtn);
		expect(onPick).toHaveBeenCalledWith(
			expect.objectContaining({ imdbId: 'tt1234567', mediaType: 'movie' })
		);
		// a bare tt id should not trigger a trakt lookup
		expect(getMock).not.toHaveBeenCalled();
	});
});
