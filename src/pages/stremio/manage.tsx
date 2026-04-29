import Poster from '@/components/poster';
import { useRealDebridAccessToken } from '@/hooks/auth';
import { useCastToken } from '@/hooks/castToken';
import { withAuth } from '@/utils/withAuth';
import { Eye, Trash2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import ptt from 'parse-torrent-title';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Toaster, toast } from 'react-hot-toast';

interface CastedLink {
	imdbId: string;
	url: string;
	hash: string;
	size: number;
	updatedAt: Date;
}

interface GroupedLinks {
	[imdbId: string]: CastedLink[];
}

interface EpisodeInfo {
	season: number;
	episode: number;
}

interface MediaMetadata {
	title: string;
	type: 'movie' | 'show';
}

export function ManagePage() {
	const [rdKey] = useRealDebridAccessToken();
	useCastToken();
	const [groupedLinks, setGroupedLinks] = useState<GroupedLinks>({});
	const [loading, setLoading] = useState(true);
	const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
	const [mediaInfo, setMediaInfo] = useState<Record<string, MediaMetadata>>({});

	const getEpisodeInfo = (imdbId: string): EpisodeInfo | null => {
		const parts = imdbId.split(':');
		if (parts.length === 3) {
			return {
				season: parseInt(parts[1]),
				episode: parseInt(parts[2]),
			};
		}
		return null;
	};

	useEffect(() => {
		const fetchLinks = async () => {
			if (!rdKey) {
				setLoading(false);
				return;
			}

			try {
				const response = await fetch(`/api/stremio/links?token=${rdKey}`);
				if (!response.ok) throw new Error('Failed to fetch links');
				const links = await response.json();

				// Group links by imdbId
				const grouped = links.reduce((acc: GroupedLinks, link: CastedLink) => {
					const baseImdbId = link.imdbId.split(':')[0]; // Handle TV show episodes
					if (!acc[baseImdbId]) {
						acc[baseImdbId] = [];
					}
					acc[baseImdbId].push(link);
					return acc;
				}, {});

				// Sort links within each group by season and episode numbers
				Object.keys(grouped).forEach((imdbId) => {
					grouped[imdbId].sort((a: CastedLink, b: CastedLink) => {
						const aEpisode = getEpisodeInfo(a.imdbId);
						const bEpisode = getEpisodeInfo(b.imdbId);
						if (!aEpisode && !bEpisode) return 0;
						if (!aEpisode) return -1;
						if (!bEpisode) return 1;
						return (
							aEpisode.season * 1000 +
							aEpisode.episode -
							(bEpisode.season * 1000 + bEpisode.episode)
						);
					});
				});

				setGroupedLinks(grouped);
			} catch (error) {
				console.error(error);
				toast.error('Failed to fetch casted links.');
			} finally {
				setLoading(false);
			}
		};

		fetchLinks();
	}, [rdKey]);

	useEffect(() => {
		const imdbIdsToFetch = Object.keys(groupedLinks).filter((imdbId) => !mediaInfo[imdbId]);
		if (imdbIdsToFetch.length === 0) return;

		let active = true;

		const loadMetadata = async () => {
			const results = await Promise.all(
				imdbIdsToFetch.map(async (imdbId) => {
					const links = groupedLinks[imdbId] ?? [];
					const isShow = links.some((link) => link.imdbId.split(':').length === 3);
					const endpoint = isShow ? '/api/info/show' : '/api/info/movie';
					const mediaType: MediaMetadata['type'] = isShow ? 'show' : 'movie';
					try {
						console.info(
							`[StremioManage] Fetching metadata for ${imdbId} using ${endpoint}`
						);
						const response = await fetch(`${endpoint}?imdbid=${imdbId}`);
						if (!response.ok) {
							throw new Error(
								`Metadata request failed with status ${response.status}`
							);
						}
						const data = await response.json();
						const title =
							typeof data.title === 'string' && data.title.trim()
								? data.title.trim()
								: imdbId;
						return {
							imdbId,
							info: {
								title,
								type: mediaType,
							},
						};
					} catch (error) {
						console.error(
							`[StremioManage] Metadata lookup failed for ${imdbId}:`,
							error
						);
						return {
							imdbId,
							info: {
								title: imdbId,
								type: mediaType,
							},
						};
					}
				})
			);

			if (!active) return;

			setMediaInfo((prev) => {
				const updated = { ...prev };
				for (const result of results) {
					updated[result.imdbId] = result.info;
				}
				return updated;
			});
		};

		void loadMetadata();

		return () => {
			active = false;
		};
	}, [groupedLinks, mediaInfo]);

	const getStremioUrl = (link: CastedLink): string => {
		const baseImdbId = link.imdbId.split(':')[0];
		const filename = link.url.split('/').pop() || '';
		const info = ptt.parse(filename);
		const seasonNumber = info.season;
		const episodeNumber = info.episode;

		if (seasonNumber !== undefined && episodeNumber !== undefined) {
			return `stremio://detail/series/${baseImdbId}/${baseImdbId}:${seasonNumber}:${episodeNumber}`;
		}
		return `stremio://detail/movie/${baseImdbId}/${baseImdbId}`;
	};

	const handleDelete = async (link: CastedLink) => {
		try {
			if (!rdKey) return;

			const response = await fetch('/api/stremio/deletelink', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					token: rdKey,
					imdbId: link.imdbId,
					hash: link.hash,
				}),
			});

			if (!response.ok) throw new Error('Failed to delete link');

			// Update state after successful deletion
			const baseImdbId = link.imdbId.split(':')[0];
			let removedImdbId: string | null = null;
			flushSync(() => {
				setGroupedLinks((prev) => {
					const newGrouped = { ...prev };
					newGrouped[baseImdbId] = newGrouped[baseImdbId].filter(
						(l) => l.url !== link.url
					);
					if (newGrouped[baseImdbId].length === 0) {
						delete newGrouped[baseImdbId];
						removedImdbId = baseImdbId;
					}
					return newGrouped;
				});
			});

			if (removedImdbId) {
				const imdbIdToRemove = removedImdbId;
				setMediaInfo((prev) => {
					if (!(imdbIdToRemove in prev)) {
						return prev;
					}
					const { [imdbIdToRemove]: _removed, ...rest } = prev;
					return rest;
				});
			}

			toast.success('Link deleted from Stremio list.');
		} catch (error) {
			console.error(error);
			toast.error('Failed to delete Stremio link.');
		}
	};

	const handleDeleteSelected = async () => {
		if (selectedLinks.size === 0) return;

		try {
			const deletePromises = Array.from(selectedLinks).map(async (url) => {
				let link: CastedLink | null = null;
				for (const links of Object.values(groupedLinks)) {
					link = links.find((l) => l.url === url) || null;
					if (link) break;
				}
				if (!link) return;

				const response = await fetch('/api/stremio/deletelink', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						token: rdKey,
						imdbId: link.imdbId,
						hash: link.hash,
					}),
				});

				if (!response.ok) throw new Error('Failed to delete link');
				return url;
			});

			const deletedUrls = (await Promise.all(deletePromises)).filter(
				(url): url is string => typeof url === 'string'
			);

			// Update state after successful deletions
			const removedImdbIds: string[] = [];
			flushSync(() => {
				setGroupedLinks((prev) => {
					const newGrouped = { ...prev };
					Object.keys(newGrouped).forEach((imdbId) => {
						newGrouped[imdbId] = newGrouped[imdbId].filter(
							(link) => !deletedUrls.includes(link.url)
						);
						if (newGrouped[imdbId].length === 0) {
							delete newGrouped[imdbId];
							removedImdbIds.push(imdbId);
						}
					});
					return newGrouped;
				});
			});

			if (removedImdbIds.length > 0) {
				setMediaInfo((prev) => {
					const updated = { ...prev };
					for (const imdbId of removedImdbIds) {
						delete updated[imdbId];
					}
					return updated;
				});
			}

			setSelectedLinks(new Set());
			toast.success('Deleted selected Stremio links.');
		} catch (error) {
			console.error(error);
			toast.error('Failed to delete selected Stremio links.');
		}
	};

	const toggleLinkSelection = (url: string) => {
		setSelectedLinks((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(url)) {
				newSet.delete(url);
			} else {
				newSet.add(url);
			}
			return newSet;
		});
	};

	const toggleGroupSelection = (imdbId: string) => {
		const links = groupedLinks[imdbId];
		const urls = links.map((link) => link.url);
		const allSelected = urls.every((url) => selectedLinks.has(url));

		setSelectedLinks((prev) => {
			const newSet = new Set(prev);
			if (allSelected) {
				urls.forEach((url) => newSet.delete(url));
			} else {
				urls.forEach((url) => newSet.add(url));
			}
			return newSet;
		});
	};

	const formatSize = (size: number) => {
		const gb = size / 1024;
		return `${gb.toFixed(2)} GB`;
	};

	const getFilename = (url: string) => {
		try {
			return decodeURIComponent(url.split('/').pop() || '');
		} catch (error) {
			return 'Unknown file';
		}
	};

	const deriveTitleFromLinks = (links: CastedLink[]): string | null => {
		for (const link of links) {
			const filename = getFilename(link.url);
			if (!filename || filename === 'Unknown file') {
				continue;
			}
			const parsed = ptt.parse(filename);
			const candidate =
				typeof parsed.title === 'string' ? parsed.title.replace(/\./g, ' ').trim() : '';
			if (candidate) {
				return candidate;
			}
		}
		return null;
	};

	const formatEpisodeLabel = (imdbId: string) => {
		const episodeInfo = getEpisodeInfo(imdbId);
		if (episodeInfo) {
			return `S${episodeInfo.season.toString().padStart(2, '0')}E${episodeInfo.episode.toString().padStart(2, '0')}`;
		}
		return null;
	};

	if (!rdKey) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900">
				<h1 className="text-center text-xl text-white">
					Debrid Media Manager is loading...
				</h1>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>DMM Cast - Manage Casted Links</title>
			</Head>
			<Image
				width={100}
				height={100}
				src="https://static.debridmediamanager.com/greenlogo.jpeg"
				alt="logo"
				className="mb-4"
			/>
			<Toaster position="bottom-right" />

			{selectedLinks.size > 0 && (
				<div className="fixed left-0 right-0 top-0 z-50 flex justify-center bg-gray-900/95 p-4 backdrop-blur">
					<button
						onClick={handleDeleteSelected}
						className="haptic-sm rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
					>
						Delete Selected ({selectedLinks.size})
					</button>
				</div>
			)}

			<div className="mb-6 flex flex-col items-center gap-4">
				<h1 className="text-xl font-bold text-white">DMM Cast - Manage Casted Links</h1>
			</div>

			{loading ? (
				<p className="text-white">Loading...</p>
			) : Object.keys(groupedLinks).length === 0 ? (
				<p className="text-white">No casted links found</p>
			) : (
				<div className="grid w-full max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-3">
					{Object.entries(groupedLinks).map(([imdbId, links]) => {
						const allSelected = links.every((link) => selectedLinks.has(link.url));
						const someSelected = links.some((link) => selectedLinks.has(link.url));
						const metadata = mediaInfo[imdbId];
						const derivedTitle = deriveTitleFromLinks(links);
						const displayTitle = metadata?.title ?? derivedTitle ?? imdbId;
						const isShowGroup =
							metadata?.type === 'show' ||
							links.some((link) => link.imdbId.split(':').length === 3);
						return (
							<div key={imdbId} className="rounded-lg bg-gray-800 p-4">
								<div className="mb-4 flex items-center justify-between">
									<label className="flex cursor-pointer items-center gap-2">
										<input
											type="checkbox"
											checked={allSelected}
											ref={(input) => {
												if (input) {
													input.indeterminate =
														someSelected && !allSelected;
												}
											}}
											onChange={() => toggleGroupSelection(imdbId)}
											className="h-4 w-4 rounded border-gray-300 bg-gray-700 text-green-600 focus:ring-green-500"
										/>
										<span className="text-sm font-medium text-white">
											Select All
										</span>
									</label>
									<Link
										href={`/x/${imdbId}`}
										className="haptic-sm rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
										title={`Cast other torrents for ${displayTitle}`}
										aria-label={`Cast other torrents for ${displayTitle}`}
									>
										Cast other torrents
									</Link>
								</div>
								<div className="mb-4 flex justify-center">
									<button
										type="button"
										onClick={() => toggleGroupSelection(imdbId)}
										aria-pressed={allSelected}
										aria-label={`Toggle selection for ${isShowGroup ? 'show' : 'movie'} ${displayTitle}`}
										className="group flex w-full max-w-[220px] flex-col items-center focus:outline-none"
									>
										<Poster imdbId={imdbId} title={displayTitle} />
										<span className="mt-2 w-full text-center text-sm font-semibold text-gray-100 group-hover:text-white">
											{displayTitle}
										</span>
									</button>
								</div>
								<div className="max-h-[300px] space-y-2 overflow-y-auto">
									{links.map((link) => {
										const episodeLabel = formatEpisodeLabel(link.imdbId);
										return (
											<div
												key={link.url}
												className="flex items-center justify-between rounded bg-gray-700 p-2"
											>
												<div className="mr-2 flex min-w-0 flex-1 items-center gap-2">
													<input
														type="checkbox"
														checked={selectedLinks.has(link.url)}
														onChange={() =>
															toggleLinkSelection(link.url)
														}
														className="h-4 w-4 rounded border-gray-300 bg-gray-600 text-green-600 focus:ring-green-500"
													/>
													<div className="flex min-w-0 flex-1 flex-col">
														{episodeLabel && (
															<span className="text-sm font-medium text-green-300">
																{episodeLabel}
															</span>
														)}
														<span className="break-all text-sm text-gray-300">
															{getFilename(link.url)}
														</span>
														<span className="text-xs text-gray-400">
															{formatSize(link.size)}
														</span>
													</div>
												</div>
												<div className="flex shrink-0 gap-2">
													<a
														href={getStremioUrl(link)}
														className="haptic-sm rounded bg-cyan-600 px-3 py-1 text-sm text-white hover:bg-cyan-700"
													>
														<Eye className="h-4 w-4" />
													</a>
													<button
														onClick={() => handleDelete(link)}
														className="haptic-sm rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
													>
														<Trash2 className="h-4 w-4" />
													</button>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			)}

			<Link
				href="/stremio"
				className="haptic-sm mt-6 rounded border-2 border-cyan-500 bg-cyan-900/30 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-800/50"
			>
				Back to Stremio
			</Link>
		</div>
	);
}

export default dynamic(() => Promise.resolve(withAuth(ManagePage)), { ssr: false });
