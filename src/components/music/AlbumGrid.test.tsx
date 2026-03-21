import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AlbumGrid from './AlbumGrid';

const makeAlbum = (overrides = {}) => ({
	hash: 'abc123',
	mbid: 'mbid-1',
	artist: 'Test Artist',
	album: 'Test Album',
	year: 2023,
	coverUrl: null,
	tracks: [],
	totalBytes: 100 * 1024 * 1024,
	trackCount: 10,
	...overrides,
});

describe('AlbumGrid', () => {
	it('renders album cards', () => {
		render(
			<AlbumGrid
				albums={[makeAlbum(), makeAlbum({ hash: 'def456', album: 'Another Album' })]}
				searchQuery=""
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		expect(screen.getByText('Test Album')).toBeInTheDocument();
		expect(screen.getByText('Another Album')).toBeInTheDocument();
	});

	it('shows empty state when no albums', () => {
		render(
			<AlbumGrid
				albums={[]}
				searchQuery=""
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		expect(screen.getByText('No music in your library')).toBeInTheDocument();
	});

	it('shows search empty state when searching with no results', () => {
		render(
			<AlbumGrid
				albums={[]}
				searchQuery="nonexistent"
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		expect(screen.getByText('No albums match your search')).toBeInTheDocument();
	});

	it('renders sort buttons', () => {
		render(
			<AlbumGrid
				albums={[]}
				searchQuery=""
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		expect(screen.getByTitle('Sort by Recent')).toBeInTheDocument();
		expect(screen.getByTitle('Sort by Name')).toBeInTheDocument();
		expect(screen.getByTitle('Sort by Artist')).toBeInTheDocument();
		expect(screen.getByTitle('Sort by Year')).toBeInTheDocument();
	});

	it('calls onSortChange when sort button clicked', async () => {
		const onSortChange = vi.fn();
		render(
			<AlbumGrid
				albums={[]}
				searchQuery=""
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={onSortChange}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);

		await userEvent.setup().click(screen.getByTitle('Sort by Name'));
		expect(onSortChange).toHaveBeenCalledWith('name');
	});

	it('highlights active sort button', () => {
		render(
			<AlbumGrid
				albums={[]}
				searchQuery=""
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="artist"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		const artistBtn = screen.getByTitle('Sort by Artist');
		expect(artistBtn.className).toContain('text-green-500');
	});
});
