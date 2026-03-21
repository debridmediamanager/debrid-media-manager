import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AlbumDetailView from './AlbumDetailView';

const makeTrack = (id: string, filename: string, trackNumber: number) => ({
	id,
	hash: 'abc123',
	fileId: trackNumber,
	link: `https://example.com/link-${id}`,
	path: `/music/${filename}`,
	bytes: 30 * 1024 * 1024,
	trackNumber,
	filename,
});

const makeAlbum = (overrides = {}) => ({
	hash: 'abc123',
	mbid: 'mbid-1',
	artist: 'Test Artist',
	album: 'Test Album',
	year: 2023,
	coverUrl: null as string | null,
	tracks: [makeTrack('t1', '01 - First.flac', 1), makeTrack('t2', '02 - Second.flac', 2)],
	totalBytes: 60 * 1024 * 1024,
	trackCount: 2,
	...overrides,
});

const defaultProps = () => ({
	album: makeAlbum(),
	currentTrack: null,
	playerState: {
		isPlaying: false,
		currentTime: 0,
		duration: 0,
		volume: 1,
		isMuted: false,
		isLoading: false,
		repeatMode: 'off' as const,
		isShuffled: false,
	},
	onPlay: vi.fn(),
	onAddToQueue: vi.fn(),
	onPlayNext: vi.fn(),
	onPlayTrackNext: vi.fn(),
	onBack: vi.fn(),
	onDownload: vi.fn(),
	hasQueue: false,
});

describe('AlbumDetailView', () => {
	it('renders album name and artist', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('Test Album')).toBeInTheDocument();
		// Artist appears multiple times (header + each track row)
		const artists = screen.getAllByText('Test Artist');
		expect(artists.length).toBeGreaterThanOrEqual(1);
	});

	it('renders year and track count', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('2023')).toBeInTheDocument();
		expect(screen.getByText('2 songs')).toBeInTheDocument();
	});

	it('renders total size', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('60.0 MB')).toBeInTheDocument();
	});

	it('renders all tracks', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('01 - First')).toBeInTheDocument();
		expect(screen.getByText('02 - Second')).toBeInTheDocument();
	});

	it('calls onBack when Back button clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		await userEvent.setup().click(screen.getByText('Back to Albums'));
		expect(props.onBack).toHaveBeenCalledTimes(1);
	});

	it('calls onPlay when Play button clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		// The main Play button
		const playButtons = screen.getAllByText('Play');
		await userEvent.setup().click(playButtons[0]);
		expect(props.onPlay).toHaveBeenCalledWith(props.album);
	});

	it('calls onAddToQueue when Add to Queue clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		await userEvent.setup().click(screen.getByText('Add to Queue'));
		expect(props.onAddToQueue).toHaveBeenCalledWith(props.album);
	});

	it('does not show Play Next button when hasQueue is false', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.queryByText('Play Next')).not.toBeInTheDocument();
	});

	it('shows Play Next button when hasQueue is true', () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} hasQueue />);
		expect(screen.getByText('Play Next')).toBeInTheDocument();
	});

	it('calls onPlayNext when Play Next clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} hasQueue />);
		await userEvent.setup().click(screen.getByText('Play Next'));
		expect(props.onPlayNext).toHaveBeenCalledWith(props.album);
	});

	it('renders cover image when coverUrl is provided', () => {
		const props = defaultProps();
		props.album = makeAlbum({ coverUrl: 'https://example.com/cover.jpg' });
		render(<AlbumDetailView {...props} />);
		const img = screen.getByAltText('Test Album');
		expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
	});

	it('does not render year when null', () => {
		const props = defaultProps();
		props.album = makeAlbum({ year: null });
		render(<AlbumDetailView {...props} />);
		expect(screen.queryByText('2023')).not.toBeInTheDocument();
	});

	it('shows play next on tracks when hasQueue', () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} hasQueue />);
		const playNextBtns = screen.getAllByTitle('Play next');
		expect(playNextBtns).toHaveLength(2);
	});

	it('does not show play next on tracks when no queue', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.queryByTitle('Play next')).not.toBeInTheDocument();
	});
});
