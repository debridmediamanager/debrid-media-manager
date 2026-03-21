import AlbumDetailView from '@/components/music/AlbumDetailView';
import AlbumGrid from '@/components/music/AlbumGrid';
import KeyboardShortcutsModal from '@/components/music/KeyboardShortcutsModal';
import MusicPlayerBar from '@/components/music/MusicPlayerBar';
import QueuePanel from '@/components/music/QueuePanel';
import { PlayerState, QueuedTrack } from '@/components/music/types';
import { removeExtension, shuffleArray } from '@/components/music/utils';
import { useRealDebridAccessToken } from '@/hooks/auth';
import useLocalStorage from '@/hooks/localStorage';
import { MusicAlbum, MusicLibraryResponse, MusicTrack } from '@/pages/api/music/library';
import { UnrestrictTrackResponse } from '@/pages/api/music/unrestrict';
import { Keyboard, Library, Loader2, Music2, X } from 'lucide-react';
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
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [sortBy, setSortBy] = useState<'recent' | 'name' | 'artist' | 'year'>('recent');

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
	const [playerState, setPlayerState] = useState<PlayerState>(() => {
		let repeatMode: 'off' | 'all' | 'one' = 'off';
		let isShuffled = false;
		if (typeof window !== 'undefined') {
			try {
				const savedRepeat = window.localStorage.getItem('music:repeatMode');
				if (savedRepeat === 'off' || savedRepeat === 'all' || savedRepeat === 'one') {
					repeatMode = savedRepeat;
				}
				const savedShuffle = window.localStorage.getItem('music:isShuffled');
				if (savedShuffle === 'true') isShuffled = true;
			} catch {}
		}
		return {
			isPlaying: false,
			currentTime: 0,
			duration: 0,
			volume: 1,
			isMuted: false,
			isLoading: false,
			repeatMode,
			isShuffled,
		};
	});

	// Persist volume
	const [savedVolume, setSavedVolume] = useLocalStorage<number>('music:volume', 1);

	// Persist queue state to localStorage (strip streamUrl and album.tracks to save space)
	useEffect(() => {
		const stripped = queue.map(({ streamUrl, album, ...rest }) => ({
			...rest,
			album: { ...album, tracks: [] },
		}));
		try {
			window.localStorage.setItem('music:queue', JSON.stringify(stripped));
		} catch {
			// QuotaExceededError — clear stale queues and retry
			window.localStorage.removeItem('music:queue');
			window.localStorage.removeItem('music:originalQueue');
		}
	}, [queue]);

	useEffect(() => {
		const stripped = originalQueue.map(({ streamUrl, album, ...rest }) => ({
			...rest,
			album: { ...album, tracks: [] },
		}));
		try {
			window.localStorage.setItem('music:originalQueue', JSON.stringify(stripped));
		} catch {
			window.localStorage.removeItem('music:queue');
			window.localStorage.removeItem('music:originalQueue');
		}
	}, [originalQueue]);

	useEffect(() => {
		window.localStorage.setItem('music:currentIndex', JSON.stringify(currentIndex));
	}, [currentIndex]);

	// Persist shuffle and repeat state
	useEffect(() => {
		window.localStorage.setItem('music:repeatMode', playerState.repeatMode);
	}, [playerState.repeatMode]);

	useEffect(() => {
		window.localStorage.setItem('music:isShuffled', String(playerState.isShuffled));
	}, [playerState.isShuffled]);

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

	// MediaSession API — OS-level media controls
	useEffect(() => {
		if (!('mediaSession' in navigator) || !currentTrack) return;

		navigator.mediaSession.metadata = new MediaMetadata({
			title: removeExtension(currentTrack.track.filename),
			artist: currentTrack.album.artist,
			album: currentTrack.album.album,
			...(currentTrack.album.coverUrl
				? {
						artwork: [
							{
								src: currentTrack.album.coverUrl,
								sizes: '600x600',
								type: 'image/jpeg',
							},
						],
					}
				: {}),
		});
	}, [currentTrack]);

	useEffect(() => {
		if (!('mediaSession' in navigator)) return;

		navigator.mediaSession.setActionHandler('play', () => togglePlay());
		navigator.mediaSession.setActionHandler('pause', () => togglePlay());
		navigator.mediaSession.setActionHandler('previoustrack', () => skipPrev());
		navigator.mediaSession.setActionHandler('nexttrack', () => skipNext());
		navigator.mediaSession.setActionHandler('seekto', (details) => {
			if (audioRef.current && details.seekTime != null) {
				audioRef.current.currentTime = details.seekTime;
			}
		});

		return () => {
			navigator.mediaSession.setActionHandler('play', null);
			navigator.mediaSession.setActionHandler('pause', null);
			navigator.mediaSession.setActionHandler('previoustrack', null);
			navigator.mediaSession.setActionHandler('nexttrack', null);
			navigator.mediaSession.setActionHandler('seekto', null);
		};
	});

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

	// Remove a track from the queue
	const removeFromQueue = (index: number) => {
		if (index < 0 || index >= queue.length) return;

		if (queue.length === 1) {
			// Last track — clear everything
			clearQueue();
			return;
		}

		if (index === currentIndex) {
			// Removing current track — stop and play next
			if (audioRef.current) {
				audioRef.current.pause();
				audioRef.current.src = '';
			}
			setQueue((prev) => prev.filter((_, i) => i !== index));
			setOriginalQueue((prev) => {
				const removedTrack = queue[index];
				return prev.filter((t) => t.track.id !== removedTrack.track.id);
			});
			// Play the track that slides into this position (or previous if at end)
			const nextIndex = index < queue.length - 1 ? index : index - 1;
			setCurrentIndex(nextIndex);
			// Defer playback to after state update
			setTimeout(
				() =>
					playTrackAtIndex(
						nextIndex,
						0,
						queue.filter((_, i) => i !== index)
					),
				0
			);
		} else {
			setQueue((prev) => prev.filter((_, i) => i !== index));
			setOriginalQueue((prev) => {
				const removedTrack = queue[index];
				return prev.filter((t) => t.track.id !== removedTrack.track.id);
			});
			if (index < currentIndex) {
				setCurrentIndex((prev) => prev - 1);
			}
		}
	};

	// Clear the entire queue
	const clearQueue = () => {
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current.src = '';
		}
		setQueue([]);
		setOriginalQueue([]);
		setCurrentIndex(-1);
		setPlayerState((prev) => ({ ...prev, isPlaying: false, isLoading: false }));
		setIsQueueOpen(false);
	};

	// Play a track/album next (insert after current track)
	const playTrackNext = (track: MusicTrack, album: MusicAlbum) => {
		const newItem: QueuedTrack = { track, album };
		const insertAt = currentIndex + 1;
		setQueue((prev) => [...prev.slice(0, insertAt), newItem, ...prev.slice(insertAt)]);
		setOriginalQueue((prev) => [...prev, newItem]);
	};

	const playAlbumNext = (album: MusicAlbum) => {
		const newTracks: QueuedTrack[] = album.tracks.map((track) => ({
			track,
			album,
		}));
		const insertAt = currentIndex + 1;
		setQueue((prev) => [...prev.slice(0, insertAt), ...newTracks, ...prev.slice(insertAt)]);
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

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement).tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			switch (e.key) {
				case ' ':
					e.preventDefault();
					togglePlay();
					break;
				case 'ArrowRight':
					e.preventDefault();
					skipNext();
					break;
				case 'ArrowLeft':
					e.preventDefault();
					skipPrev();
					break;
				case 'ArrowUp':
					e.preventDefault();
					if (audioRef.current) {
						const newVol = Math.min(1, (audioRef.current.volume ?? 1) + 0.05);
						audioRef.current.volume = newVol;
						audioRef.current.muted = false;
						setPlayerState((prev) => ({ ...prev, volume: newVol, isMuted: false }));
						setSavedVolume(newVol);
					}
					break;
				case 'ArrowDown':
					e.preventDefault();
					if (audioRef.current) {
						const newVol = Math.max(0, (audioRef.current.volume ?? 1) - 0.05);
						audioRef.current.volume = newVol;
						audioRef.current.muted = false;
						setPlayerState((prev) => ({ ...prev, volume: newVol, isMuted: false }));
						setSavedVolume(newVol);
					}
					break;
				case 'm':
				case 'M':
					toggleMute();
					break;
				case 's':
				case 'S':
					toggleShuffle();
					break;
				case 'r':
				case 'R':
					toggleRepeat();
					break;
				case 'q':
				case 'Q':
					setIsQueueOpen((prev) => !prev);
					break;
				case '?':
					setShowShortcuts((prev) => !prev);
					break;
				case 'F1':
					e.preventDefault();
					setShowShortcuts((prev) => !prev);
					break;
				case 'Escape':
					setShowShortcuts(false);
					break;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	});

	// Download a track
	const downloadTrack = async (track: MusicTrack) => {
		const streamUrl = await unrestrictAndPlay(track);
		if (!streamUrl) return;

		const a = document.createElement('a');
		a.href = streamUrl;
		a.download = track.filename;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	// Filter and sort albums
	const filteredAlbums = (() => {
		let albums =
			library?.albums.filter((album) => {
				const query = searchQuery.toLowerCase();
				return (
					album.artist.toLowerCase().includes(query) ||
					album.album.toLowerCase().includes(query)
				);
			}) ?? [];

		switch (sortBy) {
			case 'name':
				albums = [...albums].sort((a, b) => a.album.localeCompare(b.album));
				break;
			case 'artist':
				albums = [...albums].sort((a, b) => a.artist.localeCompare(b.artist));
				break;
			case 'year':
				albums = [...albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
				break;
			case 'recent':
			default:
				break; // already sorted by most recent from API
		}

		return albums;
	})();

	// Redirect if not authenticated
	if (!isLoading && !accessToken) {
		router.push('/realdebrid/login?redirect=/albums');
		return null;
	}

	return (
		<>
			<Head>
				<title>
					{currentTrack && playerState.isPlaying
						? `${removeExtension(currentTrack.track.filename)} - ${currentTrack.album.artist} - DMM`
						: selectedAlbum
							? `${selectedAlbum.album} - ${selectedAlbum.artist} - DMM`
							: 'Albums - DMM'}
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
						{/* Stats + shortcuts - mobile */}
						<div className="flex items-center gap-2 md:hidden">
							{library && (
								<span className="text-xs text-gray-400">
									{library.totalAlbums} albums &middot; {library.totalTracks}{' '}
									tracks
								</span>
							)}
							<button
								onClick={() => setShowShortcuts(true)}
								className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-gray-400"
								title="Keyboard shortcuts"
							>
								?
							</button>
						</div>
					</div>

					{/* Search */}
					<div className="relative w-full md:w-96">
						<input
							type="text"
							placeholder="Search artists or albums..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 pr-9 text-sm placeholder-gray-400 outline-none backdrop-blur-sm transition-all duration-200 focus:border-green-500/50 focus:bg-white/10 focus:ring-1 focus:ring-green-500/30"
						/>
						{searchQuery && (
							<button
								onClick={() => setSearchQuery('')}
								className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 transition-colors hover:text-white"
								title="Clear search"
							>
								<X className="h-4 w-4" />
							</button>
						)}
					</div>

					{/* Stats + shortcuts button - desktop */}
					<div className="hidden items-center gap-3 md:flex">
						{library && (
							<div className="flex items-center gap-2 text-sm text-gray-400">
								<Library className="h-4 w-4" />
								<span>
									{library.totalAlbums} albums &middot; {library.totalTracks}{' '}
									tracks
								</span>
							</div>
						)}
						<button
							onClick={() => setShowShortcuts(true)}
							className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-400 transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:text-white"
							title="Keyboard shortcuts (?)"
						>
							<Keyboard className="h-3.5 w-3.5" />
							<span>?</span>
						</button>
					</div>
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
							onPlayNext={playAlbumNext}
							onPlayTrackNext={playTrackNext}
							onBack={() => selectAlbum(null)}
							onDownload={downloadTrack}
							hasQueue={queue.length > 0}
						/>
					) : (
						<AlbumGrid
							albums={filteredAlbums}
							searchQuery={searchQuery}
							onSelect={selectAlbum}
							onPlay={playAlbum}
							sortBy={sortBy}
							onSortChange={setSortBy}
							nowPlayingAlbumHash={currentTrack?.album.hash ?? null}
							isPlaying={playerState.isPlaying}
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
						onDownload={downloadTrack}
						onRemoveTrack={removeFromQueue}
						onClearQueue={clearQueue}
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

			{showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
		</>
	);
}

AlbumsPage.disableLibraryProvider = true;
