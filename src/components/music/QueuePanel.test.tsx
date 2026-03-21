import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import QueuePanel from './QueuePanel';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
	Element.prototype.scrollIntoView = vi.fn();
});

const makeTrack = (id: string, filename: string) => ({
	id,
	hash: 'abc123',
	fileId: parseInt(id.replace('track-', '')),
	link: `https://example.com/link-${id}`,
	path: `/music/${filename}`,
	bytes: 30 * 1024 * 1024,
	trackNumber: parseInt(id.replace('track-', '')),
	filename,
});

const makeAlbum = () => ({
	hash: 'abc123',
	mbid: 'mbid-1',
	artist: 'Test Artist',
	album: 'Test Album',
	year: 2023,
	coverUrl: null,
	tracks: [],
	totalBytes: 100 * 1024 * 1024,
	trackCount: 3,
});

const makeQueue = () => {
	const album = makeAlbum();
	return [
		{ track: makeTrack('track-1', '01 - Song One.flac'), album },
		{ track: makeTrack('track-2', '02 - Song Two.flac'), album },
		{ track: makeTrack('track-3', '03 - Song Three.flac'), album },
	];
};

describe('QueuePanel', () => {
	it('renders queue header with track count', () => {
		render(
			<QueuePanel
				queue={makeQueue()}
				currentIndex={0}
				isPlaying={false}
				onPlayTrack={vi.fn()}
				onClose={vi.fn()}
				onDownload={vi.fn()}
				onRemoveTrack={vi.fn()}
				onClearQueue={vi.fn()}
			/>
		);
		expect(screen.getByText('Queue')).toBeInTheDocument();
		expect(screen.getByText('3 tracks')).toBeInTheDocument();
	});

	it('shows singular "track" for 1 item queue', () => {
		const queue = makeQueue().slice(0, 1);
		render(
			<QueuePanel
				queue={queue}
				currentIndex={0}
				isPlaying={false}
				onPlayTrack={vi.fn()}
				onClose={vi.fn()}
				onDownload={vi.fn()}
				onRemoveTrack={vi.fn()}
				onClearQueue={vi.fn()}
			/>
		);
		expect(screen.getByText('1 track')).toBeInTheDocument();
	});

	it('renders all tracks in queue', () => {
		render(
			<QueuePanel
				queue={makeQueue()}
				currentIndex={0}
				isPlaying={false}
				onPlayTrack={vi.fn()}
				onClose={vi.fn()}
				onDownload={vi.fn()}
				onRemoveTrack={vi.fn()}
				onClearQueue={vi.fn()}
			/>
		);
		expect(screen.getByText('01 - Song One')).toBeInTheDocument();
		expect(screen.getByText('02 - Song Two')).toBeInTheDocument();
		expect(screen.getByText('03 - Song Three')).toBeInTheDocument();
	});

	it('calls onClose when close button clicked', async () => {
		const onClose = vi.fn();
		render(
			<QueuePanel
				queue={makeQueue()}
				currentIndex={0}
				isPlaying={false}
				onPlayTrack={vi.fn()}
				onClose={onClose}
				onDownload={vi.fn()}
				onRemoveTrack={vi.fn()}
				onClearQueue={vi.fn()}
			/>
		);
		await userEvent.setup().click(screen.getByTitle('Close queue'));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('has clear queue button', () => {
		render(
			<QueuePanel
				queue={makeQueue()}
				currentIndex={0}
				isPlaying={false}
				onPlayTrack={vi.fn()}
				onClose={vi.fn()}
				onDownload={vi.fn()}
				onRemoveTrack={vi.fn()}
				onClearQueue={vi.fn()}
			/>
		);
		expect(screen.getByTitle('Clear queue')).toBeInTheDocument();
	});

	it('calls onClearQueue when clear button clicked', async () => {
		const onClearQueue = vi.fn();
		render(
			<QueuePanel
				queue={makeQueue()}
				currentIndex={0}
				isPlaying={false}
				onPlayTrack={vi.fn()}
				onClose={vi.fn()}
				onDownload={vi.fn()}
				onRemoveTrack={vi.fn()}
				onClearQueue={onClearQueue}
			/>
		);
		await userEvent.setup().click(screen.getByTitle('Clear queue'));
		expect(onClearQueue).toHaveBeenCalledTimes(1);
	});

	it('shows remove button on each track', () => {
		render(
			<QueuePanel
				queue={makeQueue()}
				currentIndex={0}
				isPlaying={false}
				onPlayTrack={vi.fn()}
				onClose={vi.fn()}
				onDownload={vi.fn()}
				onRemoveTrack={vi.fn()}
				onClearQueue={vi.fn()}
			/>
		);
		const removeButtons = screen.getAllByTitle('Remove from queue');
		expect(removeButtons).toHaveLength(3);
	});

	it('calls onRemoveTrack with correct index', async () => {
		const onRemoveTrack = vi.fn();
		render(
			<QueuePanel
				queue={makeQueue()}
				currentIndex={0}
				isPlaying={false}
				onPlayTrack={vi.fn()}
				onClose={vi.fn()}
				onDownload={vi.fn()}
				onRemoveTrack={onRemoveTrack}
				onClearQueue={vi.fn()}
			/>
		);
		const removeButtons = screen.getAllByTitle('Remove from queue');
		await userEvent.setup().click(removeButtons[1]);
		expect(onRemoveTrack).toHaveBeenCalledWith(1);
	});
});
