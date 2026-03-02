import AlbumDetailView from '@/components/music/AlbumDetailView';
import AlbumGrid from '@/components/music/AlbumGrid';
import MusicPlayerBar from '@/components/music/MusicPlayerBar';
import QueuePanel from '@/components/music/QueuePanel';
import { PlayerState, QueuedTrack } from '@/components/music/types';
import { shuffleArray } from '@/components/music/utils';
import { useRealDebridAccessToken } from '@/hooks/auth';
import useLocalStorage from '@/hooks/localStorage';
import { MusicAlbum, MusicLibraryResponse, MusicTrack } from '@/pages/api/music/library';
import { UnrestrictTrackResponse } from '@/pages/api/music/unrestrict';
import { Library, Loader2, Music2 } from 'lucide-react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function AlbumsPage() {
	const router = useRouter();
	const [accessToken, isLoading] = useRealDebridAccessToken();

	// Library state
	const [library, setLibrary] = useState<MusicLibraryResponse | null>(null);
	const [libraryLoading, setLibraryLoading] = useState(true);
	const [libraryError, setLibraryError] = useState<string | null>(null);

	// View state
	const [searchQuery, setSearchQuery] = useState('');
	const [isQueueOpen, setIsQueueOpen] = useState(false);

	// Get selected album from URL path param
	const slug = router.query.slug as string[] | undefined;
	const albumHash = slug?.[0];
	const selectedAlbum = library?.albums.find((a) => a.hash === albumHash) ?? null;

	// Track previous album to detect album changes
	const prevAlbumHash = useRef<string | undefined>(undefined);

	// Navigate to album (updates URL)
	const selectAlbum = (album: MusicAlbum | null) => {
		if (album) {
			if (mainRef.current) {
				savedScrollPosition.current = mainRef.current.scrollTop;
			}
			router.push(`/albums/${album.hash}`, undefined, { shallow: true });
		} else {
			router.push('/albums', undefined, { shallow: true });
		}
	};

	// Scroll to top when switching to a different album
	useEffect(() => {
		if (albumHash && albumHash !== prevAlbumHash.current && mainRef.current) {
			mainRef.current.scrollTop = 0;
		}
		prevAlbumHash.current = albumHash;
	}, [albumHash]);

	// Restore scroll position when navigating back from album to list
	useEffect(() => {
		if (!albumHash && prevAlbumHash.current && mainRef.current) {
			setTimeout(() => {
				if (mainRef.current) {
					mainRef.current.scrollTop = savedScrollPosition.current;
				}
			}, 0);
		}
	}, [albumHash]);

	// Queue and playback state (persisted to localStorage)
	const [queue, setQueue] = useState<QueuedTrack[]>(() => {
		if (typeof window === 'undefined') return [];
		try {
			const saved = window.localStorage.getItem('music:queue');
			return saved ? JSON.parse(saved) : [];
		} catch {
			return [];
		}
	});
	const [originalQueue, setOriginalQueue] = useState<QueuedTrack[]>(() => {
		if (typeof window === 'undefined') return [];
		try {
			const saved = window.localStorage.getItem('music:originalQueue');
			return saved ? JSON.parse(saved) : [];
		} catch {
			return [];
		}
	});
	const [currentIndex, setCurrentIndex] = useState<number>(() => {
		if (typeof window === 'undefined') return -1;
		try {
			const saved = window.localStorage.getItem('music:currentIndex');
			return saved !== null ? JSON.parse(saved) : -1;
		} catch {
			return -1;
		}
	});
	const [playerState, setPlayerState] = useState<PlayerState>({
		isPlaying: false,
		currentTime: 0,
		duration: 0,
		volume: 1,
		isMuted: false,
		isLoading: false,
		repeatMode: 'off',
		isShuffled: false,
	});

	// Persist volume
	const [savedVolume, setSavedVolume] = useLocalStorage<number>('music:volume', 1);

	// Persist queue state to localStorage (strip streamUrl from tracks since RD links expire)
	useEffect(() => {
		const stripped = queue.map(({ streamUrl, ...rest }) => rest);
		window.localStorage.setItem('music:queue', JSON.stringify(stripped));
	}, [queue]);

	useEffect(() => {
		const stripped = originalQueue.map(({ streamUrl, ...rest }) => rest);
		window.localStorage.setItem('music:originalQueue', JSON.stringify(stripped));
	}, [originalQueue]);

	useEffect(() => {
		window.localStorage.setItem('music:currentIndex', JSON.stringify(currentIndex));
	}, [currentIndex]);

	// Audio element ref
	const audioRef = useRef<HTMLAudioElement | null>(null);

	// Scroll container ref and saved scroll position
	const mainRef = useRef<HTMLElement | null>(null);
	const savedScrollPosition = useRef<number>(0);

	// Current track being played
	const currentTrack =
		currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

	// Fetch library on mount
	useEffect(() => {
		async function fetchLibrary() {
			try {
				setLibraryLoading(true);
				const response = await fetch('/api/music/library');
				if (!response.ok) throw new Error('Failed to fetch library');
				const data: MusicLibraryResponse = await response.json();
				setLibrary(data);
			} catch (err) {
				setLibraryError(err instanceof Error ? err.message : 'Failed to load library');
			} finally {
				setLibraryLoading(false);
			}
		}
		fetchLibrary();
	}, []);

	// Fetch album covers for albums without cover URLs
	useEffect(() => {
		if (!library || library.albums.length === 0) return;

		const albumsWithoutCovers = library.albums.filter((a) => !a.coverUrl);
		if (albumsWithoutCovers.length === 0) return;

		let isCancelled = false;

		async function fetchCovers() {
			for (const album of albumsWithoutCovers) {
				if (isCancelled) break;

				try {
					const response = await fetch('/api/music/cover', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							mbid: album.mbid,
							artist: album.artist,
							album: album.album,
						}),
					});

					if (response.ok) {
						const data = await response.json();
						if (data.coverUrl) {
							setLibrary((prev) => {
								if (!prev) return prev;
								return {
									...prev,
									albums: prev.albums.map((a) =>
										a.mbid === album.mbid
											? { ...a, coverUrl: data.coverUrl }
											: a
									),
								};
							});
						}
					}
				} catch (err) {
					console.error(`Failed to fetch cover for ${album.album}:`, err);
				}

				await new Promise((r) => setTimeout(r, 200));
			}
		}

		fetchCovers();

		return () => {
			isCancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [library?.albums.length]);

	// Handle track ended — defined before audio init so the ref is available
	const handleTrackEndedRef = useRef<() => void>(() => {});
	const handleTrackEnded = useCallback(() => {
		if (playerState.repeatMode === 'one') {
			if (audioRef.current) {
				audioRef.current.currentTime = 0;
				audioRef.current.play();
			}
		} else if (currentIndex < queue.length - 1) {
			playTrackAtIndex(currentIndex + 1);
		} else if (playerState.repeatMode === 'all' && queue.length > 0) {
			playTrackAtIndex(0);
		} else {
			setPlayerState((prev) => ({ ...prev, isPlaying: false }));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentIndex, queue.length, playerState.repeatMode]);
	handleTrackEndedRef.current = handleTrackEnded;

	// Initialize audio element
	useEffect(() => {
		const audio = new Audio();
		audio.volume = savedVolume ?? 1;
		audioRef.current = audio;

		audio.addEventListener('timeupdate', () => {
			setPlayerState((prev) => ({ ...prev, currentTime: audio.currentTime }));
		});

		audio.addEventListener('durationchange', () => {
			setPlayerState((prev) => ({ ...prev, duration: audio.duration }));
		});

		audio.addEventListener('ended', () => {
			handleTrackEndedRef.current();
		});

		audio.addEventListener('play', () => {
			setPlayerState((prev) => ({ ...prev, isPlaying: true }));
		});

		audio.addEventListener('pause', () => {
			setPlayerState((prev) => ({ ...prev, isPlaying: false }));
		});

		audio.addEventListener('waiting', () => {
			setPlayerState((prev) => ({ ...prev, isLoading: true }));
		});

		audio.addEventListener('canplay', () => {
			setPlayerState((prev) => ({ ...prev, isLoading: false }));
		});

		audio.addEventListener('error', () => {
			setPlayerState((prev) => ({ ...prev, isLoading: false, isPlaying: false }));
		});

		return () => {
			audio.pause();
			audio.src = '';
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Unrestrict and play a track
	const unrestrictAndPlay = async (track: MusicTrack): Promise<string | undefined> => {
		if (!accessToken) return undefined;

		try {
			const response = await fetch('/api/music/unrestrict', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					link: track.link,
					hash: track.hash,
					fileId: track.fileId,
					accessToken,
				}),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				console.error('Unrestrict failed:', {
					status: response.status,
					error: errorData.error,
					errorCode: errorData.errorCode,
					hash: track.hash,
					fileId: track.fileId,
				});
				throw new Error(errorData.error || 'Failed to unrestrict');
			}

			const data: UnrestrictTrackResponse = await response.json();
			return data.streamUrl;
		} catch (err) {
			console.error('Failed to unrestrict track:', err);
			return undefined;
		}
	};

	// Play a track at a specific queue index
	// optionally accepts a queueOverride for when the queue state hasn't updated yet
	const playTrackAtIndex = async (
		index: number,
		retryCount = 0,
		queueOverride?: QueuedTrack[]
	) => {
		const activeQueue = queueOverride ?? queue;
		if (index < 0 || index >= activeQueue.length) return;
		if (retryCount > 5) {
			console.error('Too many failed attempts to play tracks');
			setPlayerState((prev) => ({ ...prev, isLoading: false, isPlaying: false }));
			return;
		}

		const queuedTrack = activeQueue[index];
		setCurrentIndex(index);
		setPlayerState((prev) => ({ ...prev, isLoading: true }));

		let streamUrl = queuedTrack.streamUrl;

		if (!streamUrl) {
			streamUrl = await unrestrictAndPlay(queuedTrack.track);
			if (!streamUrl) {
				console.error(`Failed to load track: ${queuedTrack.track.filename}, skipping...`);
				playTrackAtIndex(index + 1, retryCount + 1, activeQueue);
				return;
			}

			setQueue((prev) =>
				prev.map((item, i) => (i === index ? { ...item, streamUrl } : item))
			);
		}

		if (audioRef.current) {
			audioRef.current.src = streamUrl;
			audioRef.current.play().catch(console.error);
		}
	};

	// Play an album
	const playAlbum = (album: MusicAlbum, startTrackIndex: number = 0) => {
		const newQueue: QueuedTrack[] = album.tracks.map((track) => ({
			track,
			album,
		}));

		setQueue(newQueue);
		setOriginalQueue(newQueue);
		setPlayerState((prev) => ({ ...prev, isShuffled: false }));
		playTrackAtIndex(startTrackIndex, 0, newQueue);
	};

	// Add album to queue
	const addAlbumToQueue = (album: MusicAlbum) => {
		const newTracks: QueuedTrack[] = album.tracks.map((track) => ({
			track,
			album,
		}));

		setQueue((prev) => [...prev, ...newTracks]);
		setOriginalQueue((prev) => [...prev, ...newTracks]);
	};

	// Toggle play/pause
	const togglePlay = () => {
		if (!audioRef.current) return;

		if (playerState.isPlaying) {
			audioRef.current.pause();
		} else if (!audioRef.current.src || audioRef.current.src === window.location.href) {
			// No audio loaded (e.g. after restore from localStorage) — unrestrict and play
			if (currentIndex >= 0 && currentIndex < queue.length) {
				playTrackAtIndex(currentIndex);
			}
		} else {
			audioRef.current.play().catch(console.error);
		}
	};

	// Skip to next track
	const skipNext = () => {
		if (currentIndex < queue.length - 1) {
			playTrackAtIndex(currentIndex + 1);
		} else if (playerState.repeatMode === 'all') {
			playTrackAtIndex(0);
		}
	};

	// Skip to previous track
	const skipPrev = () => {
		if (audioRef.current && audioRef.current.currentTime > 3) {
			audioRef.current.currentTime = 0;
		} else if (currentIndex > 0) {
			playTrackAtIndex(currentIndex - 1);
		}
	};

	// Toggle shuffle
	const toggleShuffle = () => {
		if (playerState.isShuffled) {
			const currentTrackId = currentTrack?.track.id;
			const newIndex = originalQueue.findIndex((t) => t.track.id === currentTrackId);
			setQueue(originalQueue);
			setCurrentIndex(newIndex >= 0 ? newIndex : 0);
		} else {
			const currentTrackItem = currentTrack;
			const otherTracks = queue.filter((_, i) => i !== currentIndex);
			const shuffled = shuffleArray(otherTracks);
			const newQueue = currentTrackItem ? [currentTrackItem, ...shuffled] : shuffled;
			setQueue(newQueue);
			setCurrentIndex(0);
		}
		setPlayerState((prev) => ({ ...prev, isShuffled: !prev.isShuffled }));
	};

	// Toggle repeat mode
	const toggleRepeat = () => {
		setPlayerState((prev) => ({
			...prev,
			repeatMode:
				prev.repeatMode === 'off' ? 'all' : prev.repeatMode === 'all' ? 'one' : 'off',
		}));
	};

	// Seek
	const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
		const time = parseFloat(e.target.value);
		if (audioRef.current) {
			audioRef.current.currentTime = time;
		}
	};

	// Volume
	const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
		const volume = parseFloat(e.target.value);
		if (audioRef.current) {
			audioRef.current.volume = volume;
			audioRef.current.muted = false;
		}
		setPlayerState((prev) => ({ ...prev, volume, isMuted: false }));
		setSavedVolume(volume);
	};

	// Toggle mute
	const toggleMute = () => {
		if (audioRef.current) {
			audioRef.current.muted = !playerState.isMuted;
		}
		setPlayerState((prev) => ({ ...prev, isMuted: !prev.isMuted }));
	};

	// Filter albums by search
	const filteredAlbums =
		library?.albums.filter((album) => {
			const query = searchQuery.toLowerCase();
			return (
				album.artist.toLowerCase().includes(query) ||
				album.album.toLowerCase().includes(query)
			);
		}) ?? [];

	// Redirect if not authenticated
	if (!isLoading && !accessToken) {
		router.push('/realdebrid/login?redirect=/albums');
		return null;
	}

	return (
		<>
			<Head>
				<title>
					{selectedAlbum ? `${selectedAlbum.album} - ${selectedAlbum.artist}` : 'Albums'}{' '}
					- DMM
				</title>
			</Head>

			<div className="flex h-screen flex-col bg-gradient-to-b from-gray-900 via-gray-900 to-black text-white">
				{/* Header */}
				<header className="flex flex-col gap-3 border-b border-white/5 bg-black/30 px-4 py-3 backdrop-blur-md md:flex-row md:items-center md:justify-between md:px-6 md:py-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Music2 className="h-5 w-5 text-green-500 md:h-6 md:w-6" />
							<h1 className="text-lg font-bold md:text-xl">Albums</h1>
						</div>
						{/* Stats - mobile inline, desktop separate */}
						{library && (
							<div className="flex items-center gap-2 text-xs text-gray-400 md:hidden">
								<span>
									{library.totalAlbums} albums &middot; {library.totalTracks}{' '}
									tracks
								</span>
							</div>
						)}
					</div>

					{/* Search */}
					<div className="w-full md:w-96">
						<input
							type="text"
							placeholder="Search artists or albums..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm placeholder-gray-400 outline-none backdrop-blur-sm transition-all duration-200 focus:border-green-500/50 focus:bg-white/10 focus:ring-1 focus:ring-green-500/30"
						/>
					</div>

					{/* Stats - desktop only */}
					{library && (
						<div className="hidden items-center gap-2 text-sm text-gray-400 md:flex">
							<Library className="h-4 w-4" />
							<span>
								{library.totalAlbums} albums &middot; {library.totalTracks} tracks
							</span>
						</div>
					)}
				</header>

				{/* Main content */}
				<main ref={mainRef} className="flex-1 overflow-y-auto pb-24 md:pb-32">
					{libraryLoading ? (
						<div className="flex h-full items-center justify-center">
							<Loader2 className="h-8 w-8 animate-spin text-green-500" />
						</div>
					) : libraryError ? (
						<div className="flex h-full items-center justify-center text-red-400">
							{libraryError}
						</div>
					) : selectedAlbum ? (
						<AlbumDetailView
							album={selectedAlbum}
							currentTrack={currentTrack}
							playerState={playerState}
							onPlay={playAlbum}
							onAddToQueue={addAlbumToQueue}
							onBack={() => selectAlbum(null)}
						/>
					) : (
						<AlbumGrid
							albums={filteredAlbums}
							searchQuery={searchQuery}
							onSelect={selectAlbum}
							onPlay={playAlbum}
						/>
					)}
				</main>

				{/* Queue Panel */}
				{currentTrack && isQueueOpen && (
					<QueuePanel
						queue={queue}
						currentIndex={currentIndex}
						isPlaying={playerState.isPlaying}
						onPlayTrack={(index) => playTrackAtIndex(index)}
						onClose={() => setIsQueueOpen(false)}
					/>
				)}

				{/* Floating Player Bar */}
				{currentTrack && (
					<MusicPlayerBar
						currentTrack={currentTrack}
						playerState={playerState}
						onTogglePlay={togglePlay}
						onSkipNext={skipNext}
						onSkipPrev={skipPrev}
						onToggleShuffle={toggleShuffle}
						onToggleRepeat={toggleRepeat}
						onSeek={handleSeek}
						onVolumeChange={handleVolume}
						onToggleMute={toggleMute}
						onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
						isQueueOpen={isQueueOpen}
					/>
				)}
			</div>
		</>
	);
}

AlbumsPage.disableLibraryProvider = true;
