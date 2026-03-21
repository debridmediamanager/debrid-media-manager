import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AlbumCard from './AlbumCard';

const makeAlbum = (overrides = {}) => ({
	hash: 'abc123',
	mbid: 'mbid-1',
	artist: 'Test Artist',
	album: 'Test Album',
	year: 2023,
	coverUrl: null as string | null,
	tracks: [],
	totalBytes: 100 * 1024 * 1024,
	trackCount: 10,
	...overrides,
});

describe('AlbumCard', () => {
	it('renders album name, artist, year and track count', () => {
		render(<AlbumCard album={makeAlbum()} onSelect={vi.fn()} onPlay={vi.fn()} />);
		expect(screen.getByText('Test Album')).toBeInTheDocument();
		expect(screen.getByText(/Test Artist/)).toBeInTheDocument();
		expect(screen.getByText('10 tracks')).toBeInTheDocument();
	});

	it('shows singular "track" for 1 track', () => {
		render(
			<AlbumCard album={makeAlbum({ trackCount: 1 })} onSelect={vi.fn()} onPlay={vi.fn()} />
		);
		expect(screen.getByText('1 track')).toBeInTheDocument();
	});

	it('calls onSelect when clicked', async () => {
		const onSelect = vi.fn();
		const album = makeAlbum();
		render(<AlbumCard album={album} onSelect={onSelect} onPlay={vi.fn()} />);

		// The card itself is the first button role element
		const buttons = screen.getAllByRole('button');
		await userEvent.setup().click(buttons[0]);
		expect(onSelect).toHaveBeenCalledWith(album);
	});

	it('calls onSelect on Enter key', async () => {
		const onSelect = vi.fn();
		const album = makeAlbum();
		render(<AlbumCard album={album} onSelect={onSelect} onPlay={vi.fn()} />);

		const buttons = screen.getAllByRole('button');
		buttons[0].focus();
		await userEvent.setup().keyboard('{Enter}');
		expect(onSelect).toHaveBeenCalledWith(album);
	});

	it('shows "PLAYING" badge when isNowPlaying and isPlaying', () => {
		render(
			<AlbumCard
				album={makeAlbum()}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				isNowPlaying
				isPlaying
			/>
		);
		expect(screen.getByText('PLAYING')).toBeInTheDocument();
	});

	it('shows "PAUSED" badge when isNowPlaying but not isPlaying', () => {
		render(
			<AlbumCard
				album={makeAlbum()}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				isNowPlaying
				isPlaying={false}
			/>
		);
		expect(screen.getByText('PAUSED')).toBeInTheDocument();
	});

	it('does not show now-playing badge when not now playing', () => {
		render(
			<AlbumCard
				album={makeAlbum()}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				isNowPlaying={false}
			/>
		);
		expect(screen.queryByText('PLAYING')).not.toBeInTheDocument();
		expect(screen.queryByText('PAUSED')).not.toBeInTheDocument();
	});

	it('renders cover image when coverUrl is provided', () => {
		render(
			<AlbumCard
				album={makeAlbum({ coverUrl: 'https://example.com/cover.jpg' })}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
			/>
		);
		const img = screen.getByAltText('Test Album');
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
	});

	it('does not render cover image when coverUrl is null', () => {
		render(
			<AlbumCard album={makeAlbum({ coverUrl: null })} onSelect={vi.fn()} onPlay={vi.fn()} />
		);
		expect(screen.queryByAltText('Test Album')).not.toBeInTheDocument();
	});
});
