import AlbumDetailView from '@/components/music/AlbumDetailView';
import AlbumGrid, { AlbumTypeFilter } from '@/components/music/AlbumGrid';
import ArtistView from '@/components/music/ArtistView';
import ContextMenu, {
	albumMenuItems,
	MenuActions,
	menuAt,
	OpenMenu,
	trackMenuItems,
} from '@/components/music/ContextMenu';
import DownloadAlbumModal from '@/components/music/DownloadAlbumModal';
import HomeView from '@/components/music/HomeView';
import KeyboardShortcutsModal from '@/components/music/KeyboardShortcutsModal';
import LibraryPane from '@/components/music/LibraryPane';
import LikedView from '@/components/music/LikedView';
import MusicPlayerBar from '@/components/music/MusicPlayerBar';
import NowPlayingPanel from '@/components/music/NowPlayingPanel';
import { MusicPlayerProvider, useMusicPlayer } from '@/components/music/player/MusicPlayerProvider';
import { accountPersistence } from '@/components/music/player/persistence';
import PlaylistView from '@/components/music/PlaylistView';
import { musicHref, MusicRoute, parseMusicRoute } from '@/components/music/routes';
import SearchView from '@/components/music/SearchView';
import TopBar, { SearchBox } from '@/components/music/TopBar';
import { QueuedTrack } from '@/components/music/types';
import { MusicUserProvider, useMusicUser } from '@/components/music/user/MusicUserProvider';
import { albumItems, trackRef, trackTitle } from '@/components/music/utils';
import { useRealDebrid, useRealDebridAccessToken } from '@/hooks/auth';
import useLocalStorage from '@/hooks/localStorage';
import { MusicAlbum, MusicLibraryResponse, MusicTrack } from '@/pages/api/music/library';
import type { MusicPlayerStateResponse } from '@/pages/api/music/me/state';
import { UnrestrictTrackResponse } from '@/pages/api/music/unrestrict';
import { toasterPosition } from '@/utils/toastOptions';
import { House, Library, Loader2, Search } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { MouseEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Toaster } from 'react-hot-toast';

const MUSIC_PAGE_SIZE = 48;
const RECENT_ALBUM_LIMIT = 12;
const ALBUM_DOWNLOAD_DELAY_MS = 250;

async function unrestrictTrack(
	track: MusicTrack,
	accessToken: string | null
): Promise<string | undefined> {
	if (!accessToken) return undefined;

	// Failures throw with the server's explanation; the player shows it.
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
			throw new Error(
				errorData.error || "Couldn't play this right now. Try again in a while."
			);
		}

		const data: UnrestrictTrackResponse = await response.json();
		return data.streamUrl;
	} catch (err) {
		console.error('Failed to unrestrict track:', err);
		throw err;
	}
}

// Library and search results are summaries without tracks; this request has them.
async function fetchAlbum(hash: string): Promise<MusicAlbum | null> {
	const response = await fetch(`/api/music/library?hash=${encodeURIComponent(hash)}`);
	if (!response.ok) throw new Error('Failed to fetch album');
	const data: MusicLibraryResponse = await response.json();
	return data.albums[0] ?? null;
}

/** Whether the media query matches; follows the window as it resizes. */
function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(
		() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
	);
	useEffect(() => {
		const list = window.matchMedia?.(query);
		if (!list) return;
		const update = () => setMatches(list.matches);
		update();
		list.addEventListener?.('change', update);
		return () => list.removeEventListener?.('change', update);
	}, [query]);
	return matches;
}

const fullScreenSpinner = (
	<div className="flex h-dvh items-center justify-center bg-gray-900">
		<Loader2 className="h-8 w-8 animate-spin text-green-500" />
	</div>
);

const musicNeedsRealDebrid = (
	<div className="flex h-dvh flex-col items-center justify-center gap-4 bg-gray-900 px-4 text-center text-gray-100">
		<Head>
			<title>Debrid Media Manager - Music</title>
		</Head>
		<h1 className="text-xl font-bold">Music plays through Real-Debrid</h1>
		<p className="max-w-sm text-sm text-gray-400">
			Connect a Real-Debrid account to listen. A key from TorBox or another service will not
			work here.
		</p>
		<Link
			href="/realdebrid/login?redirect=/music"
			className="rounded bg-green-700 px-4 py-2 text-white hover:bg-green-800"
		>
			Connect Real-Debrid
		</Link>
		<Link href="/" className="text-sm text-gray-400 underline hover:text-gray-200">
			Back to home
		</Link>
	</div>
);

export default function AlbumsPage() {
	const [accessToken, isLoading] = useRealDebridAccessToken();
	const rdUser = useRealDebrid().user;

	if (!accessToken) {
		// Music streams only through Real-Debrid. Sending a TorBox or AllDebrid user
		// straight to the RD sign-in left them pasting their own key there (Reddit 1xp8m5s).
		return isLoading ? fullScreenSpinner : musicNeedsRealDebrid;
	}
	// The music session belongs to one account: wait to know which.
	if (!rdUser && isLoading) return fullScreenSpinner;

	return (
		<MusicUserProvider accessToken={accessToken} account={rdUser ? String(rdUser.id) : null}>
			<MusicPlayerRoot accessToken={accessToken} />
			<Toaster position={toasterPosition()} />
		</MusicUserProvider>
	);
}

function MusicPlayerRoot({ accessToken }: { accessToken: string }) {
	const { musicFetch } = useMusicUser();
	const resolveStreamUrl = useCallback(
		(track: MusicTrack) => unrestrictTrack(track, accessToken),
		[accessToken]
	);
	const [persistence] = useState(() =>
		accountPersistence({
			get: async () => {
				const res = await musicFetch('/api/music/me/state');
				return res.ok ? ((await res.json()) as MusicPlayerStateResponse).state : null;
			},
			put: async (state) => {
				const res = await musicFetch('/api/music/me/state', {
					method: 'PUT',
					body: JSON.stringify({ state }),
				});
				if (!res.ok) throw new Error(`Saving the player failed: ${res.status}`);
			},
		})
	);
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		void persistence.hydrate().finally(() => setHydrated(true));
	}, [persistence]);
	const onTrackPlayed = useCallback(
		(item: QueuedTrack) => {
			musicFetch('/api/music/me/history', {
				method: 'POST',
				body: JSON.stringify(trackRef(item.track, item.album)),
			}).catch(() => {});
		},
		[musicFetch]
	);

	if (!hydrated) return fullScreenSpinner;
	return (
		<MusicPlayerProvider
			resolveStreamUrl={resolveStreamUrl}
			persistence={persistence}
			onTrackPlayed={onTrackPlayed}
		>
			<MusicLibrary resolveStreamUrl={resolveStreamUrl} />
		</MusicPlayerProvider>
	);
}

AlbumsPage.disableLibraryProvider = true;

function MusicLibrary({
	resolveStreamUrl,
}: {
	resolveStreamUrl: (track: MusicTrack) => Promise<string | undefined>;
}) {
	const router = useRouter();
	const player = useMusicPlayer();
	const user = useMusicUser();
	const currentTrack = player.nowPlaying?.item ?? null;
	const [menu, setMenu] = useState<OpenMenu | null>(null);
	const [albumToDownload, setAlbumToDownload] = useState<MusicAlbum | null>(null);

	// Library state
	const [library, setLibrary] = useState<MusicLibraryResponse | null>(null);
	const [libraryLoading, setLibraryLoading] = useState(true);
	const [libraryLoadingMore, setLibraryLoadingMore] = useState(false);
	const [libraryError, setLibraryError] = useState<string | null>(null);
	const [recentAlbums, setRecentAlbums] = useState<MusicAlbum[]>([]);
	// From the unfiltered recent-albums request, so a search never changes them.
	const [catalogTotals, setCatalogTotals] = useState<Pick<
		MusicLibraryResponse,
		'totalAlbums' | 'totalTracks'
	> | null>(null);

	// Layout: phones below 768 px, tablets to 1023 px, desktops from 1024 px
	const phone = !useMediaQuery('(min-width: 768px)');
	const desktop = useMediaQuery('(min-width: 1024px)');
	const wide = useMediaQuery('(min-width: 1280px)');
	const [collapsedByUser, setCollapsedByUser] = useState(false);

	// Now Playing: a pane desktops remember, an overlay elsewhere.
	const [paneOpen, setPaneOpen] = useLocalStorage<boolean>('music:nowPlayingOpen', true);
	const [overlayOpen, setOverlayOpen] = useState(false);
	const nowPlayingOpen = desktop ? paneOpen !== false : overlayOpen;
	const toggleNowPlaying = () =>
		desktop ? setPaneOpen(!nowPlayingOpen) : setOverlayOpen(!nowPlayingOpen);
	// Below 1280 px two open panes leave the page too little room: the library gives way.
	const libraryForced = !desktop || (!wide && nowPlayingOpen && !!currentTrack);
	const libraryCollapsed = libraryForced || collapsedByUser;
	const toggleNowPlayingRef = useRef(toggleNowPlaying);
	toggleNowPlayingRef.current = toggleNowPlaying;

	// View state
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [sortBy, setSortBy] = useState<'recent' | 'name' | 'artist' | 'year'>('name');
	const [albumType, setAlbumType] = useState<AlbumTypeFilter>('all');

	const route = parseMusicRoute(router.query.slug, router.query.q);
	const albumHash = route.name === 'album' ? route.hash : undefined;
	const routeQ = route.name === 'search' ? route.q : null;
	const showsGrid = route.name === 'browse';
	const selectedAlbumSummary = library?.albums.find((a) => a.hash === albumHash) ?? null;
	const [selectedAlbumDetail, setSelectedAlbumDetail] = useState<MusicAlbum | null>(null);
	const [selectedAlbumLoading, setSelectedAlbumLoading] = useState(false);
	const selectedAlbum =
		albumHash && selectedAlbumDetail?.hash === albumHash
			? selectedAlbumDetail
			: selectedAlbumSummary;

	// Scroll container ref, and each page's scroll offset for back and forward
	const mainRef = useRef<HTMLElement | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const scrollByPath = useRef(new Map<string, number>());
	const pushed = useRef(false);
	const libraryRequestId = useRef<number>(0);
	const loadedCatalogKey = useRef<string | null>(null);
	const recentAlbumsRequestId = useRef<number>(0);

	const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
	const navigate = useCallback(
		(to: MusicRoute, replace = false) => {
			// A search typed just before must not pull the page back to its results.
			clearTimeout(searchTimeout.current);
			pushed.current = true;
			void router[replace ? 'replace' : 'push'](musicHref(to), undefined, { shallow: true });
		},
		[router]
	);

	// The old album URL was /music/<hash>.
	const slugLength = Array.isArray(router.query.slug) ? router.query.slug.length : 0;
	useEffect(() => {
		if (slugLength === 1 && albumHash) navigate({ name: 'album', hash: albumHash }, true);
	}, [albumHash, navigate, slugLength]);

	// A new page starts at the top; back and forward return to where it was left.
	useEffect(() => {
		const main = mainRef.current;
		if (!main) return;
		const top = pushed.current ? 0 : (scrollByPath.current.get(router.asPath) ?? 0);
		pushed.current = false;
		const timeout = setTimeout(() => (main.scrollTop = top), 0);
		return () => clearTimeout(timeout);
	}, [router.asPath]);

	// The search box navigates as you type; back and forward bring its text along.
	const searchInput = useRef<HTMLInputElement | null>(null);
	const [searchText, setSearchText] = useState(route.name === 'search' ? route.q : '');
	useEffect(() => {
		if (route.name === 'search' && document.activeElement !== searchInput.current) {
			setSearchText(route.q);
		}
	}, [routeQ]); // eslint-disable-line react-hooks/exhaustive-deps
	const search = (q: string) => {
		setSearchText(q);
		clearTimeout(searchTimeout.current);
		const replace = route.name === 'search';
		searchTimeout.current = setTimeout(() => navigate({ name: 'search', q }, replace), 250);
	};
	useEffect(() => () => clearTimeout(searchTimeout.current), []);
	const registerSearchInput = useCallback(
		(input: HTMLInputElement | null) => {
			searchInput.current = input;
			player.registerSearchInput(input);
		},
		[player.registerSearchInput] // eslint-disable-line react-hooks/exhaustive-deps
	);

	const selectAlbum = (album: MusicAlbum) => navigate({ name: 'album', hash: album.hash });

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
				if (albumType !== 'all') params.set('type', albumType);

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
		[albumType, sortBy]
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
				setCatalogTotals({ totalAlbums: data.totalAlbums, totalTracks: data.totalTracks });
			}
		} catch (err) {
			console.error('Failed to fetch recent albums:', err);
		}
	}, []);

	// Kept while another page shows, so coming back keeps the loaded pages and the scroll.
	useEffect(() => {
		const key = `${sortBy}\n${albumType}`;
		if (!showsGrid || key === loadedCatalogKey.current) return;
		loadedCatalogKey.current = key;
		fetchLibraryPage(1, false);
	}, [albumType, fetchLibraryPage, showsGrid, sortBy]);

	useEffect(() => {
		fetchRecentAlbums();
	}, [fetchRecentAlbums]);

	useEffect(() => {
		if (
			!showsGrid ||
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
		showsGrid,
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
				const album = await fetchAlbum(activeAlbumHash);
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

	// UI shortcuts; the player provider handles the playback ones.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement).tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			switch (e.key) {
				case 'q':
				case 'Q':
					toggleNowPlayingRef.current();
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
	}, []);

	const withTracks = useCallback(async (album: MusicAlbum) => {
		try {
			return album.tracks.length ? album : await fetchAlbum(album.hash);
		} catch (err) {
			console.error('Failed to load the album tracks:', err);
			return null;
		}
	}, []);

	const playAlbum = async (album: MusicAlbum, startIndex: number = 0) => {
		const full = await withTracks(album);
		if (full) player.playContext(albumItems(full), startIndex, `album:${full.hash}`);
	};

	// Download a track
	const triggerBrowserDownload = (streamUrl: string, filename: string) => {
		const a = document.createElement('a');
		a.href = streamUrl;
		a.download = filename;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	const downloadTrack = async (track: MusicTrack) => {
		const streamUrl = await resolveStreamUrl(track);
		if (!streamUrl) return;
		triggerBrowserDownload(streamUrl, track.filename);
	};

	const downloadAlbum = async (album: MusicAlbum) => {
		for (const track of album.tracks) {
			const streamUrl = await resolveStreamUrl(track);
			if (!streamUrl) continue;
			triggerBrowserDownload(streamUrl, track.filename);
			await new Promise((resolve) => setTimeout(resolve, ALBUM_DOWNLOAD_DELAY_MS));
		}
	};

	const menuActions: MenuActions = {
		player,
		user,
		navigate,
		withTracks,
		download: (track) => void downloadTrack(track),
		downloadAlbum: setAlbumToDownload,
	};
	const openTrackMenu = (e: MouseEvent, item: QueuedTrack) =>
		setMenu(menuAt(e, trackMenuItems(item, menuActions)));
	const openAlbumMenu = (e: MouseEvent, album: MusicAlbum) =>
		setMenu(menuAt(e, albumMenuItems(album, menuActions)));

	const visibleAlbums = library?.albums ?? [];

	const spinner = (
		<div className="flex h-full items-center justify-center">
			<Loader2 className="h-8 w-8 animate-spin text-green-500" />
		</div>
	);

	const grid = libraryLoading ? (
		spinner
	) : libraryError ? (
		<div className="flex h-full items-center justify-center text-red-400">{libraryError}</div>
	) : (
		<>
			<AlbumGrid
				albums={visibleAlbums}
				onSelect={selectAlbum}
				onPlay={playAlbum}
				sortBy={sortBy}
				onSortChange={setSortBy}
				type={albumType}
				onTypeChange={setAlbumType}
				nowPlayingAlbumHash={currentTrack?.album.hash ?? null}
				isPlaying={player.isPlaying}
				onCoverLoaded={handleCoverLoaded}
				onAlbumMenu={openAlbumMenu}
			/>
			<div
				ref={loadMoreRef}
				className="flex min-h-20 items-center justify-center pb-8 text-sm text-gray-400"
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
	);

	const nowPlaying = (
		<NowPlayingPanel
			navigate={navigate}
			onClose={toggleNowPlaying}
			onTrackMenu={openTrackMenu}
		/>
	);

	let content: ReactNode;
	switch (route.name) {
		case 'home':
			content = (
				<HomeView
					navigate={navigate}
					newAlbums={recentAlbums}
					onPlayAlbum={playAlbum}
					onAlbumMenu={openAlbumMenu}
					onCoverLoaded={handleCoverLoaded}
				/>
			);
			break;
		case 'album':
			content =
				selectedAlbum && selectedAlbum.tracks.length > 0 ? (
					<AlbumDetailView
						album={selectedAlbum}
						navigate={navigate}
						onDownloadAlbum={setAlbumToDownload}
						onCoverLoaded={handleCoverLoaded}
						onMenu={(e) => openAlbumMenu(e, selectedAlbum)}
						onTrackMenu={(e, track) =>
							openTrackMenu(e, { track, album: selectedAlbum })
						}
					/>
				) : selectedAlbumLoading ? (
					spinner
				) : (
					<div className="flex h-full items-center justify-center text-gray-400">
						This album is not in the catalog.
					</div>
				);
			break;
		case 'search':
			content = (
				<SearchView
					q={searchText}
					navigate={navigate}
					onPlayAlbum={playAlbum}
					onAlbumMenu={openAlbumMenu}
					onTrackMenu={openTrackMenu}
					onCoverLoaded={handleCoverLoaded}
					recentAlbums={recentAlbums}
					onBrowseType={(type) => {
						setAlbumType(type);
						navigate({ name: 'browse' });
					}}
				/>
			);
			break;
		case 'artist':
			content = (
				<ArtistView
					key={route.mbid}
					mbid={route.mbid}
					navigate={navigate}
					onPlayAlbum={playAlbum}
					onAlbumMenu={openAlbumMenu}
					onTrackMenu={openTrackMenu}
					onCoverLoaded={handleCoverLoaded}
				/>
			);
			break;
		case 'liked':
			content = <LikedView onTrackMenu={openTrackMenu} onDownload={downloadTrack} />;
			break;
		case 'playlist':
			content = (
				<PlaylistView
					key={route.id}
					id={route.id}
					navigate={navigate}
					onMenu={(e, items) => setMenu(menuAt(e, items))}
					onTrackMenu={openTrackMenu}
					onDownload={downloadTrack}
				/>
			);
			break;
		case 'library':
			content = (
				<div className="h-full p-2">
					<LibraryPane route={route} navigate={navigate} />
				</div>
			);
			break;
		default:
			content = grid;
	}

	return (
		<>
			<Head>
				<title>
					{currentTrack && player.isPlaying
						? `${trackTitle(currentTrack.track)} - ${currentTrack.album.artist} - DMM`
						: selectedAlbum
							? `${selectedAlbum.album} - ${selectedAlbum.artist} - DMM`
							: 'Music - DMM'}
				</title>
			</Head>

			<div className="flex h-dvh flex-col bg-gradient-to-b from-gray-900 via-gray-900 to-black text-white">
				<div className={`relative flex min-h-0 flex-1 ${phone ? '' : 'gap-2 p-2'}`}>
					{!phone && (
						<aside
							className={`shrink-0 transition-[width] duration-200 ${
								libraryCollapsed ? 'w-20' : 'w-72'
							}`}
						>
							<LibraryPane
								route={route}
								navigate={navigate}
								collapsed={libraryCollapsed}
								onToggleCollapsed={
									libraryForced
										? undefined
										: () => setCollapsedByUser((prev) => !prev)
								}
								onFocusSearch={() => searchInput.current?.focus()}
							/>
						</aside>
					)}

					<div
						className={`flex min-w-0 flex-1 flex-col overflow-hidden ${
							phone ? '' : 'rounded-lg bg-black/25'
						}`}
					>
						{!phone ? (
							<TopBar
								searchText={searchText}
								onSearch={search}
								registerSearchInput={registerSearchInput}
								catalogTotals={catalogTotals}
								onShowShortcuts={() => setShowShortcuts(true)}
							/>
						) : (
							route.name === 'search' && (
								<div className="flex px-3 pt-3">
									<SearchBox
										value={searchText}
										onSearch={search}
										inputRef={registerSearchInput}
									/>
								</div>
							)
						)}
						<main
							ref={mainRef}
							onScroll={(e) =>
								scrollByPath.current.set(router.asPath, e.currentTarget.scrollTop)
							}
							className="min-h-0 flex-1 overflow-y-auto"
						>
							{content}
						</main>
					</div>

					{currentTrack && nowPlayingOpen && desktop && (
						<aside className="w-80 shrink-0 overflow-hidden rounded-lg bg-black/25">
							{nowPlaying}
						</aside>
					)}
					{currentTrack && nowPlayingOpen && !desktop && !phone && (
						<>
							<div
								className="absolute inset-0 z-30 bg-black/40"
								onClick={() => setOverlayOpen(false)}
							/>
							<aside className="absolute inset-y-2 right-2 z-30 w-96 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg bg-gray-900 shadow-music-2xl">
								{nowPlaying}
							</aside>
						</>
					)}
				</div>

				{currentTrack && (
					<MusicPlayerBar
						currentTrack={currentTrack}
						playerState={player}
						onTogglePlay={player.togglePlay}
						onSkipNext={player.next}
						onSkipPrev={player.prev}
						onToggleShuffle={player.toggleShuffle}
						onToggleRepeat={player.cycleRepeat}
						onSeek={player.seek}
						onVolumeChange={player.setVolume}
						onToggleMute={player.toggleMute}
						onToggleQueue={toggleNowPlaying}
						isQueueOpen={nowPlayingOpen}
						onOpenNowPlaying={phone ? () => setOverlayOpen(true) : undefined}
						isLiked={user.isLiked(currentTrack.track.id)}
						onToggleLike={() => {
							const ref = trackRef(currentTrack.track, currentTrack.album);
							if (user.isLiked(currentTrack.track.id)) user.unlike(ref);
							else user.like(ref);
						}}
					/>
				)}

				{phone && (
					<nav
						aria-label="Music"
						className="grid shrink-0 grid-cols-3 bg-black pb-[env(safe-area-inset-bottom)]"
					>
						{(
							[
								['Home', House, { name: 'home' }, route.name === 'home'],
								[
									'Search',
									Search,
									{ name: 'search', q: searchText },
									route.name === 'search',
								],
								[
									'Your Library',
									Library,
									{ name: 'library' },
									['library', 'liked', 'playlist'].includes(route.name),
								],
							] as const
						).map(([label, Icon, to, active]) => (
							<button
								key={label}
								type="button"
								onClick={() => navigate(to)}
								aria-current={active ? 'page' : undefined}
								className={`flex flex-col items-center gap-1 py-2 text-[11px] font-medium ${
									active ? 'text-white' : 'text-gray-400'
								}`}
							>
								<Icon className="h-6 w-6" />
								{label}
							</button>
						))}
					</nav>
				)}
			</div>

			{phone && currentTrack && nowPlayingOpen && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Now Playing"
					className="fixed inset-0 z-[70] flex flex-col bg-gradient-to-b from-gray-800 via-gray-900 to-black pt-[env(safe-area-inset-top)] text-white"
				>
					<NowPlayingPanel
						sheet
						navigate={navigate}
						onClose={() => setOverlayOpen(false)}
						onTrackMenu={openTrackMenu}
					/>
				</div>
			)}
			{showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
			{menu && (
				<ContextMenu
					key={`${menu.x}:${menu.y}`}
					menu={menu}
					sheet={phone}
					onClose={() => setMenu(null)}
				/>
			)}
			{albumToDownload && (
				<DownloadAlbumModal
					album={albumToDownload}
					onConfirm={() => {
						setAlbumToDownload(null);
						void downloadAlbum(albumToDownload);
					}}
					onClose={() => setAlbumToDownload(null)}
				/>
			)}
		</>
	);
}
