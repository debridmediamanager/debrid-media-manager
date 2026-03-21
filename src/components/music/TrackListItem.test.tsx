import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TrackListItem from './TrackListItem';

const makeTrack = (overrides = {}) => ({
	id: 'track-1',
	hash: 'abc123',
	fileId: 1,
	link: 'https://example.com/link',
	path: '/music/01 - Test Song.flac',
	bytes: 30 * 1024 * 1024,
	trackNumber: 1,
	filename: '01 - Test Song.flac',
	...overrides,
});

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

describe('TrackListItem', () => {
	it('renders track filename without extension', () => {
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
			/>
		);
		expect(screen.getByText('01 - Test Song')).toBeInTheDocument();
	});

	it('renders artist name', () => {
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
			/>
		);
		expect(screen.getByText('Test Artist')).toBeInTheDocument();
	});

	it('renders file size', () => {
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
			/>
		);
		expect(screen.getByText('30.0 MB')).toBeInTheDocument();
	});

	it('calls onPlay when clicked', async () => {
		const onPlay = vi.fn();
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={onPlay}
				onDownload={vi.fn()}
			/>
		);
		await userEvent.setup().click(screen.getByRole('button'));
		expect(onPlay).toHaveBeenCalledTimes(1);
	});

	it('shows download button', () => {
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
			/>
		);
		expect(screen.getByTitle('Download')).toBeInTheDocument();
	});

	it('shows remove button when showRemove is true', () => {
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
				onRemove={vi.fn()}
				showRemove
			/>
		);
		expect(screen.getByTitle('Remove from queue')).toBeInTheDocument();
	});

	it('does not show remove button when showRemove is false', () => {
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
				onRemove={vi.fn()}
				showRemove={false}
			/>
		);
		expect(screen.queryByTitle('Remove from queue')).not.toBeInTheDocument();
	});

	it('calls onRemove when remove button clicked', async () => {
		const onRemove = vi.fn();
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
				onRemove={onRemove}
				showRemove
			/>
		);
		await userEvent.setup().click(screen.getByTitle('Remove from queue'));
		expect(onRemove).toHaveBeenCalledTimes(1);
	});

	it('shows play next button when onPlayNext is provided', () => {
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
				onPlayNext={vi.fn()}
			/>
		);
		expect(screen.getByTitle('Play next')).toBeInTheDocument();
	});

	it('calls onPlayNext with track and album', async () => {
		const onPlayNext = vi.fn();
		const track = makeTrack();
		const album = makeAlbum();
		render(
			<TrackListItem
				track={track}
				index={0}
				album={album}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
				onPlayNext={onPlayNext}
			/>
		);
		await userEvent.setup().click(screen.getByTitle('Play next'));
		expect(onPlayNext).toHaveBeenCalledWith(track, album);
	});

	it('applies green highlight when isCurrentTrack', () => {
		render(
			<TrackListItem
				track={makeTrack()}
				index={0}
				album={makeAlbum()}
				isCurrentTrack
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
			/>
		);
		const btn = screen.getByRole('button');
		expect(btn.className).toContain('bg-green-500/10');
		expect(btn.className).toContain('border-l-green-500');
	});

	it('shows track number from track data', () => {
		render(
			<TrackListItem
				track={makeTrack({ trackNumber: 5 })}
				index={4}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
			/>
		);
		expect(screen.getByText('5')).toBeInTheDocument();
	});

	it('falls back to index+1 when trackNumber is null', () => {
		render(
			<TrackListItem
				track={makeTrack({ trackNumber: null })}
				index={2}
				album={makeAlbum()}
				isCurrentTrack={false}
				isPlaying={false}
				onPlay={vi.fn()}
				onDownload={vi.fn()}
			/>
		);
		expect(screen.getByText('3')).toBeInTheDocument();
	});
});
