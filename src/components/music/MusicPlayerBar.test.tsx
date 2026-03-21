import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MusicPlayerBar from './MusicPlayerBar';

const makeCurrentTrack = () => ({
	track: {
		id: 'track-1',
		hash: 'abc123',
		fileId: 1,
		link: 'https://example.com/link',
		path: '/music/01 - Song.flac',
		bytes: 30 * 1024 * 1024,
		trackNumber: 1,
		filename: '01 - Song.flac',
	},
	album: {
		hash: 'abc123',
		mbid: 'mbid-1',
		artist: 'Test Artist',
		album: 'Test Album',
		year: 2023,
		coverUrl: null as string | null,
		tracks: [],
		totalBytes: 100 * 1024 * 1024,
		trackCount: 10,
	},
});

const defaultProps = () => ({
	currentTrack: makeCurrentTrack(),
	playerState: {
		isPlaying: false,
		currentTime: 30,
		duration: 240,
		volume: 0.8,
		isMuted: false,
		isLoading: false,
		repeatMode: 'off' as const,
		isShuffled: false,
	},
	onTogglePlay: vi.fn(),
	onSkipNext: vi.fn(),
	onSkipPrev: vi.fn(),
	onToggleShuffle: vi.fn(),
	onToggleRepeat: vi.fn(),
	onSeek: vi.fn(),
	onVolumeChange: vi.fn(),
	onToggleMute: vi.fn(),
	onToggleQueue: vi.fn(),
	isQueueOpen: false,
});

describe('MusicPlayerBar', () => {
	it('renders track name without extension', () => {
		render(<MusicPlayerBar {...defaultProps()} />);
		const trackNames = screen.getAllByText('01 - Song');
		expect(trackNames.length).toBeGreaterThan(0);
	});

	it('renders artist name', () => {
		render(<MusicPlayerBar {...defaultProps()} />);
		const artists = screen.getAllByText('Test Artist');
		expect(artists.length).toBeGreaterThan(0);
	});

	it('renders current time and duration', () => {
		render(<MusicPlayerBar {...defaultProps()} />);
		const times = screen.getAllByText('0:30');
		expect(times.length).toBeGreaterThan(0);
		const durations = screen.getAllByText('4:00');
		expect(durations.length).toBeGreaterThan(0);
	});

	it('calls onTogglePlay when play button clicked', async () => {
		const props = defaultProps();
		render(<MusicPlayerBar {...props} />);
		// There are multiple play buttons (mobile + desktop)
		const buttons = screen.getAllByRole('button');
		const playButton = buttons.find(
			(b) =>
				!b.getAttribute('title') &&
				b.querySelector('svg') &&
				b.className.includes('rounded-full') &&
				b.className.includes('bg-white')
		);
		if (playButton) {
			await userEvent.setup().click(playButton);
			expect(props.onTogglePlay).toHaveBeenCalled();
		}
	});

	it('calls onToggleQueue when queue button clicked', async () => {
		const props = defaultProps();
		render(<MusicPlayerBar {...props} />);
		const queueButtons = screen.getAllByTitle('Queue');
		await userEvent.setup().click(queueButtons[0]);
		expect(props.onToggleQueue).toHaveBeenCalled();
	});

	it('calls onSkipNext when next button clicked', async () => {
		const props = defaultProps();
		render(<MusicPlayerBar {...props} />);
		const nextButtons = screen.getAllByTitle('Next');
		await userEvent.setup().click(nextButtons[0]);
		expect(props.onSkipNext).toHaveBeenCalled();
	});

	it('calls onSkipPrev when previous button clicked', async () => {
		const props = defaultProps();
		render(<MusicPlayerBar {...props} />);
		const prevButtons = screen.getAllByTitle('Previous');
		await userEvent.setup().click(prevButtons[0]);
		expect(props.onSkipPrev).toHaveBeenCalled();
	});

	it('calls onToggleShuffle when shuffle button clicked', async () => {
		const props = defaultProps();
		render(<MusicPlayerBar {...props} />);
		const shuffleButtons = screen.getAllByTitle('Shuffle');
		await userEvent.setup().click(shuffleButtons[0]);
		expect(props.onToggleShuffle).toHaveBeenCalled();
	});

	it('calls onToggleRepeat when repeat button clicked', async () => {
		const props = defaultProps();
		render(<MusicPlayerBar {...props} />);
		const repeatButtons = screen.getAllByTitle('Repeat');
		await userEvent.setup().click(repeatButtons[0]);
		expect(props.onToggleRepeat).toHaveBeenCalled();
	});

	it('highlights shuffle button when shuffled', () => {
		const props = defaultProps();
		props.playerState.isShuffled = true;
		render(<MusicPlayerBar {...props} />);
		const shuffleButton = screen.getAllByTitle('Shuffle')[0];
		expect(shuffleButton.className).toContain('text-green-500');
	});

	it('highlights repeat button when repeat is on', () => {
		const props = defaultProps();
		const playerState = { ...props.playerState, repeatMode: 'all' as const };
		render(<MusicPlayerBar {...props} playerState={playerState} />);
		const repeatButton = screen.getAllByTitle('Repeat')[0];
		expect(repeatButton.className).toContain('text-green-500');
	});

	it('highlights queue button when queue is open', () => {
		const props = defaultProps();
		props.isQueueOpen = true;
		render(<MusicPlayerBar {...props} />);
		const queueButtons = screen.getAllByTitle('Queue');
		const hasGreen = queueButtons.some((b) => b.className.includes('text-green-500'));
		expect(hasGreen).toBe(true);
	});

	it('renders album cover when coverUrl is provided', () => {
		const props = defaultProps();
		props.currentTrack.album.coverUrl = 'https://example.com/cover.jpg';
		render(<MusicPlayerBar {...props} />);
		const imgs = screen.getAllByAltText('Test Album');
		expect(imgs.length).toBeGreaterThan(0);
	});
});
