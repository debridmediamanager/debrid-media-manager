import { MusicAlbum, MusicTrack } from '@/pages/api/music/library';

export interface PlayerState {
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	isMuted: boolean;
	isLoading: boolean;
	repeatMode: 'off' | 'all' | 'one';
	isShuffled: boolean;
}

export interface QueuedTrack {
	track: MusicTrack;
	album: MusicAlbum;
	streamUrl?: string;
}
