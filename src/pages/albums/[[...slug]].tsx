import AlbumDetailView from '@/components/music/AlbumDetailView';
import AlbumGrid from '@/components/music/AlbumGrid';
import KeyboardShortcutsModal from '@/components/music/KeyboardShortcutsModal';
import MusicPlayerBar from '@/components/music/MusicPlayerBar';
import QueuePanel from '@/components/music/QueuePanel';
import { PlayerState, QueuedTrack } from '@/components/music/types';
import { formatTrackTitle, shuffleArray } from '@/components/music/utils';
import { useRealDebridAccessToken } from '@/hooks/auth';
import useLocalStorage from '@/hooks/localStorage';
import { MusicAlbum, MusicLibraryResponse, MusicTrack } from '@/pages/api/music/library';
import { UnrestrictTrackResponse } from '@/pages/api/music/unrestrict';
import { Keyboard, Library, Loader2, Music2, X } from 'lucide-react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MUSIC_BASE_PATH = '/music';
const MUSIC_PAGE_SIZE = 48;
const RECENT_ALBUM_LIMIT = 24;

interface SidebarAlbumButtonProps {
	album: MusicAlbum;
	isSelected: boolean;
	onSelect: (album: MusicAlbum) => void;
	onCoverLoaded: (album: MusicAlbum, coverUrl: string) => void;
}

function SidebarAlbumButton({
	album,
	isSelected,
	onSelect,
	onCoverLoaded,
}: SidebarAlbumButtonProps) {
	const [coverUrl, setCoverUrl] = useState(album.coverUrl);

	useEffect(() => {
		setCoverUrl(album.coverUrl);
	}, [album.coverUrl]);

	useEffect(() => {
		if (coverUrl) return;
		let isCancelled = false;

		async function fetchCover() {
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

				if (!response.ok) return;
				const data = await response.json();
				if (!isCancelled && data.coverUrl) {
					setCoverUrl(data.coverUrl);
					onCoverLoaded(album, data.coverUrl);
				}
			} catch (err) {
				console.error(`Failed to fetch cover for ${album.album}:`, err);
			}
		}

		fetchCover();
		return () => {
			isCancelled = true;
		};
	}, [album, coverUrl, onCoverLoaded]);

	return (
		<button
			type="button"
			onClick={() => onSelect(album)}
			aria-current={isSelected ? 'true' : undefined}
			aria-label={`Open ${album.album} by ${album.artist}`}
			className={`flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
				isSelected
					? 'bg-white/10 text-white'
					: 'text-gray-300 hover:bg-white/5 hover:text-white'
			}`}
		>
			<div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-800">
				<Music2 className="h-4 w-4 text-gray-500" />
				{coverUrl && (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={coverUrl}
						alt={album.album}
						loading="lazy"
						className="absolute inset-0 h-full w-full object-cover"
						onError={(e) => {
							(e.target as HTMLImageElement).style.display = 'none';
						}}
					/>
				)}
			</div>
			<div className="min-w-0">
				<p className="truncate text-sm font-medium">{album.album}</p>
				<p className="truncate text-xs text-gray-500">{album.artist}</p>
			</div>
		</button>
	);
}

export default function AlbumsPage() {
	const router = useRouter();
	const [accessToken, isLoading] = useRealDebridAccessToken();

	// Library state
	const [library, setLibrary] = useState<MusicLibraryResponse | null>(null);
	const [libraryLoading, setLibraryLoading] = useState(true);
	const [libraryLoadingMore, setLibraryLoadingMore] = useState(false);
	const [libraryError, setLibraryError] = useState<string | null>(null);
	const [recentAlbums, setRecentAlbums] = useState<MusicAlbum[]>([]);

	// View state
	const [searchQuery, setSearchQuery] = useState('');
	const [isQueueOpen, setIsQueueOpen] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [sortBy, setSortBy] = useState<'recent' | 'name' | 'artist' | 'year'>('name');

	// Get selected album from URL path param
	const slug = router.query.slug as string[] | undefined;
	const albumHash = slug?.[0];
	const selectedAlbumSummary = library?.albums.find((a) => a.hash === albumHash) ?? null;
	const [selectedAlbumDetail, setSelectedAlbumDetail] = useState<MusicAlbum | null>(null);
	const [selectedAlbumLoading, setSelectedAlbumLoading] = useState(false);
	const selectedAlbum =
		albumHash && selectedAlbumDetail?.hash === albumHash
			? selectedAlbumDetail
			: selectedAlbumSummary;

	// Track previous album to detect album changes
	const prevAlbumHash = useRef<string | undefined>(undefined);

	// Navigate to album (updates URL)
	const selectAlbum = (album: MusicAlbum | null) => {
		if (album) {
			if (mainRef.current) {
				savedScrollPosition.current = mainRef.current.scrollTop;
			}
			router.push(`${MUSIC_BASE_PATH}/${album.hash}`, undefined, { shallow: true });
		} else {
			router.push(MUSIC_BASE_PATH, undefined, { shallow: true });
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
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const savedScrollPosition = useRef<number>(0);
	const libraryRequestId = useRef<number>(0);
	const recentAlbumsRequestId = useRef<number>(0);

	// Current track being played
	const currentTrack =
		currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

	const handleCoverLoaded = useCallback((album: MusicAlbum, coverUrl: string) => {
		setLibrary((prev) =>
			prev
				? {
						...prev,
						albums: prev.albums.map((existing) =>
							existing.mbid === album.mbid ? { ...existing, coverUrl } : existing
						),
					}
				: prev
		);
		setRecentAlbums((prev) =>
			prev.map((existing) =>
				existing.mbid === album.mbid ? { ...existing, coverUrl } : existing
			)
		);
		setSelectedAlbumDetail((prev) =>
			prev?.mbid === album.mbid ? { ...prev, coverUrl } : prev
		);
	}, []);

	const fetchLibraryPage = useCallback(
		async (pageToLoad: number = 1, append: boolean = false) => {
			const requestId = ++libraryRequestId.current;
			try {
				setLibraryError(null);
				if (append) {
					setLibraryLoadingMore(true);
				} else {
					setLibraryLoading(true);
				}
				const params = new URLSearchParams({
					summary: '1',
					page: String(pageToLoad),
					limit: String(MUSIC_PAGE_SIZE),
					sortBy,
				});
				const trimmedSearch = searchQuery.trim();
				if (trimmedSearch) params.set('search', trimmedSearch);

				const response = await fetch(`/api/music/library?${params.toString()}`);
				if (!response.ok) throw new Error('Failed to fetch library');
				const data: MusicLibraryResponse = await response.json();
				if (requestId !== libraryRequestId.current) return;

				setLibrary((prev) => {
					if (!append || !prev) return data;
					const existingHashes = new Set(prev.albums.map((album) => album.hash));
					const nextAlbums = data.albums.filter(
						(album) => !existingHashes.has(album.hash)
					);
					return {
						...data,
						albums: [...prev.albums, ...nextAlbums],
					};
				});
			} catch (err) {
				if (requestId === libraryRequestId.current) {
					setLibraryError(err instanceof Error ? err.message : 'Failed to load library');
				}
			} finally {
				if (requestId === libraryRequestId.current) {
					setLibraryLoading(false);
					setLibraryLoadingMore(false);
				}
			}
		},
		[searchQuery, sortBy]
	);

	const fetchRecentAlbums = useCallback(async () => {
		const requestId = ++recentAlbumsRequestId.current;
		try {
			const params = new URLSearchParams({
				summary: '1',
				page: '1',
				limit: String(RECENT_ALBUM_LIMIT),
				sortBy: 'recent',
			});
			const response = await fetch(`/api/music/library?${params.toString()}`);
			if (!response.ok) throw new Error('Failed to fetch recent albums');
			const data: MusicLibraryResponse = await response.json();
			if (requestId === recentAlbumsRequestId.current) {
				setRecentAlbums(data.albums);
			}
		} catch (err) {
			console.error('Failed to fetch recent albums:', err);
		}
	}, []);

	useEffect(() => {
		const timeout = setTimeout(
			() => {
				fetchLibraryPage(1, false);
			},
			searchQuery.trim() ? 250 : 0
		);
		return () => clearTimeout(timeout);
	}, [fetchLibraryPage, searchQuery]);

	useEffect(() => {
		fetchRecentAlbums();
	}, [fetchRecentAlbums]);

	useEffect(() => {
		if (
			albumHash ||
			!library?.hasMore ||
			libraryLoading ||
			libraryLoadingMore ||
			!loadMoreRef.current
		) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting) && library.hasMore) {
					fetchLibraryPage(library.nextPage ?? (library.page ?? 1) + 1, true);
				}
			},
			{ rootMargin: '600px' }
		);
		observer.observe(loadMoreRef.current);
		return () => observer.disconnect();
	}, [
		albumHash,
		fetchLibraryPage,
		library?.hasMore,
		library?.nextPage,
		library?.page,
		libraryLoading,
		libraryLoadingMore,
	]);

	useEffect(() => {
		if (!albumHash) {
			setSelectedAlbumDetail(null);
			setSelectedAlbumLoading(false);
			return;
		}

		let isCancelled = false;
		const activeAlbumHash = albumHash;

		async function fetchAlbumDetail() {
			try {
				setSelectedAlbumLoading(true);
				const response = await fetch(
					`/api/music/library?hash=${encodeURIComponent(activeAlbumHash)}`
				);
				if (!response.ok) throw new Error('Failed to fetch album');
				const data: MusicLibraryResponse = await response.json();
				const album = data.albums[0] ?? null;
				if (!isCancelled) {
					setSelectedAlbumDetail(album);
					if (album) {
						setLibrary((prev) =>
							prev
								? {
										...prev,
										albums: prev.albums.map((existing) =>
											existing.hash === album.hash ? album : existing
										),
									}
								: prev
						);
					}
				}
			} catch (err) {
				console.error('Failed to fetch album detail:', err);
				if (!isCancelled) setSelectedAlbumDetail(null);
			} finally {
				if (!isCancelled) setSelectedAlbumLoading(false);
			}
		}

		fetchAlbumDetail();

		return () => {
			isCancelled = true;
		};
	}, [albumHash]);

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

	// Attach audio element ref (rendered as <audio> in JSX for mobile background playback)
	const audioRefCallback = useCallback(
		(audio: HTMLAudioElement | null) => {
			if (!audio || audioRef.current === audio) return;
			audioRef.current = audio;
			audio.volume = savedVolume ?? 1;

			audio.addEventListener('timeupdate', () => {
				setPlayerState((prev) => ({ ...prev, currentTime: audio.currentTime }));
				if ('mediaSession' in navigator && audio.duration && isFinite(audio.duration)) {
					navigator.mediaSession.setPositionState({
						duration: audio.duration,
						playbackRate: audio.playbackRate,
						position: audio.currentTime,
					});
				}
			});

			audio.addEventListener('durationchange', () => {
				setPlayerState((prev) => ({ ...prev, duration: audio.duration }));
			});

			audio.addEventListener('ended', () => {
				handleTrackEndedRef.current();
			});

			audio.addEventListener('play', () => {
				setPlayerState((prev) => ({ ...prev, isPlaying: true }));
				if ('mediaSession' in navigator) {
					navigator.mediaSession.playbackState = 'playing';
				}
			});

			audio.addEventListener('pause', () => {
				setPlayerState((prev) => ({ ...prev, isPlaying: false }));
				if ('mediaSession' in navigator) {
					navigator.mediaSession.playbackState = 'paused';
				}
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
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[]
	);

	// MediaSession API — OS-level media controls
	useEffect(() => {
		if (!('mediaSession' in navigator) || !currentTrack) return;

		navigator.mediaSession.metadata = new MediaMetadata({
			title: formatTrackTitle(currentTrack.track.filename),
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

	const visibleAlbums = library?.albums ?? [];
	const sidebarAlbums = useMemo(() => recentAlbums.slice(0, RECENT_ALBUM_LIMIT), [recentAlbums]);

	// Redirect if not authenticated
	if (!isLoading && !accessToken) {
		router.push(`/realdebrid/login?redirect=${MUSIC_BASE_PATH}`);
		return null;
	}

	return (
		<>
			<Head>
				<title>
					{currentTrack && playerState.isPlaying
						? `${formatTrackTitle(currentTrack.track.filename)} - ${currentTrack.album.artist} - DMM`
						: selectedAlbum
							? `${selectedAlbum.album} - ${selectedAlbum.artist} - DMM`
							: 'Music - DMM'}
				</title>
			</Head>

			<div className="flex h-screen flex-col bg-gradient-to-b from-gray-900 via-gray-900 to-black text-white">
				{/* Header */}
				<header className="flex flex-col gap-3 border-b border-white/5 bg-black/30 px-4 py-3 backdrop-blur-md md:flex-row md:items-center md:justify-between md:px-6 md:py-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Music2 className="h-5 w-5 text-green-500 md:h-6 md:w-6" />
							<h1 className="text-lg font-bold md:text-xl">Music</h1>
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
								type="button"
								onClick={() => setShowShortcuts(true)}
								className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-gray-400"
								aria-label="Keyboard shortcuts"
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
							aria-label="Search artists or albums"
							className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 pr-9 text-sm placeholder-gray-400 outline-none backdrop-blur-sm transition-all duration-200 focus:border-green-500/50 focus:bg-white/10 focus:ring-1 focus:ring-green-500/30"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery('')}
								className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 transition-colors hover:text-white"
								aria-label="Clear search"
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
							type="button"
							onClick={() => setShowShortcuts(true)}
							className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-400 transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:text-white"
							aria-label="Keyboard shortcuts"
							title="Keyboard shortcuts (?)"
						>
							<Keyboard className="h-3.5 w-3.5" />
							<span>?</span>
						</button>
					</div>
				</header>

				<div className="flex min-h-0 flex-1">
					<aside className="hidden w-72 flex-col border-r border-white/5 bg-black/25 lg:flex">
						<div className="border-b border-white/5 p-4">
							<button
								type="button"
								onClick={() => selectAlbum(null)}
								aria-current={!albumHash ? 'page' : undefined}
								className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-bold transition-colors ${
									albumHash
										? 'text-gray-300 hover:bg-white/5 hover:text-white'
										: 'bg-white/10 text-white'
								}`}
							>
								<Library className="h-4 w-4" />
								Your Library
							</button>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto p-2">
							<p className="px-3 py-2 text-xs font-bold uppercase text-gray-500">
								Recently added
							</p>
							{sidebarAlbums.map((album) => (
								<SidebarAlbumButton
									key={album.hash}
									album={album}
									isSelected={album.hash === albumHash}
									onSelect={selectAlbum}
									onCoverLoaded={handleCoverLoaded}
								/>
							))}
						</div>
					</aside>

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
						) : selectedAlbum && selectedAlbum.tracks.length > 0 ? (
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
								onCoverLoaded={handleCoverLoaded}
							/>
						) : albumHash && selectedAlbumLoading ? (
							<div className="flex h-full items-center justify-center">
								<Loader2 className="h-8 w-8 animate-spin text-green-500" />
							</div>
						) : (
							<>
								<AlbumGrid
									albums={visibleAlbums}
									searchQuery={searchQuery}
									onSelect={selectAlbum}
									onPlay={playAlbum}
									sortBy={sortBy}
									onSortChange={setSortBy}
									nowPlayingAlbumHash={currentTrack?.album.hash ?? null}
									isPlaying={playerState.isPlaying}
									onCoverLoaded={handleCoverLoaded}
								/>
								<div
									ref={loadMoreRef}
									className="flex min-h-20 items-center justify-center pb-8 text-sm text-gray-500"
								>
									{libraryLoadingMore ? (
										<Loader2 className="h-5 w-5 animate-spin text-green-500" />
									) : library?.hasMore ? (
										<span>Loading more albums...</span>
									) : visibleAlbums.length > 0 ? (
										<span>End of library</span>
									) : null}
								</div>
							</>
						)}
					</main>
				</div>

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
			{/* DOM-attached audio element for reliable mobile background playback */}
			<audio ref={audioRefCallback} playsInline preload="auto" />
		</>
	);
}

AlbumsPage.disableLibraryProvider = true;
