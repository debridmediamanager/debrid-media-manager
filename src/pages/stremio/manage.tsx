import { useCastToken } from '@/hooks/cast';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { Logo } from '../../components/Logo';
import Poster from '../../components/poster';
import { withAuth } from '../../utils/withAuth';

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

function ManagePage() {
	const dmmCastToken = useCastToken();
	const [groupedLinks, setGroupedLinks] = useState<GroupedLinks>({});
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchLinks = async () => {
			if (dmmCastToken) {
				try {
					const response = await fetch(`/api/stremio/links?token=${dmmCastToken}`);
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
					toast.error('Failed to fetch casted links');
				}
				setLoading(false);
			}
		};

		fetchLinks();
	}, [dmmCastToken]);

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

	const handleDelete = async (link: CastedLink) => {
		try {
			if (!dmmCastToken) return;

			const response = await fetch('/api/stremio/deletelink', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					token: dmmCastToken,
					imdbId: link.imdbId,
					hash: link.hash,
				}),
			});

			if (!response.ok) throw new Error('Failed to delete link');

			// Update state after successful deletion
			setGroupedLinks((prev) => {
				const newGrouped = { ...prev };
				const baseImdbId = link.imdbId.split(':')[0];
				newGrouped[baseImdbId] = newGrouped[baseImdbId].filter((l) => l.url !== link.url);
				if (newGrouped[baseImdbId].length === 0) {
					delete newGrouped[baseImdbId];
				}
				return newGrouped;
			});

			toast.success('Link deleted successfully');
		} catch (error) {
			console.error(error);
			toast.error('Failed to delete link');
		}
	};

	const formatSize = (size: number) => {
		const gb = size / 1024;
		return `${gb.toFixed(2)} GB`;
	};

	const getFilename = (url: string) => {
		try {
			const urlObj = new URL(url);
			const pathParts = urlObj.pathname.split('/');
			const lastPart = pathParts[pathParts.length - 1];
			return decodeURIComponent(lastPart);
		} catch (error) {
			return 'Unknown file';
		}
	};

	const formatEpisodeLabel = (imdbId: string) => {
		const episodeInfo = getEpisodeInfo(imdbId);
		if (episodeInfo) {
			return `S${episodeInfo.season.toString().padStart(2, '0')}E${episodeInfo.episode.toString().padStart(2, '0')}`;
		}
		return null;
	};

	if (!dmmCastToken) {
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
				<title>DMM - Manage Casted Links</title>
			</Head>
			<Logo />
			<Toaster position="bottom-right" />

			<h1 className="mb-6 text-xl font-bold text-white">Manage Casted Links</h1>

			{loading ? (
				<p className="text-white">Loading...</p>
			) : Object.keys(groupedLinks).length === 0 ? (
				<p className="text-white">No casted links found</p>
			) : (
				<div className="grid w-full max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-3">
					{Object.entries(groupedLinks).map(([imdbId, links]) => (
						<div key={imdbId} className="rounded-lg bg-gray-800 p-4">
							<div className="mb-4 flex justify-center">
								<Poster imdbId={imdbId} title={imdbId} />
							</div>
							<div className="space-y-2">
								{links.map((link) => {
									const episodeLabel = formatEpisodeLabel(link.imdbId);
									return (
										<div
											key={link.url}
											className="flex items-center justify-between rounded bg-gray-700 p-2"
										>
											<div className="mr-2 flex min-w-0 flex-1 flex-col">
												{episodeLabel && (
													<span className="text-sm font-medium text-purple-300">
														{episodeLabel}
													</span>
												)}
												<span className="truncate text-sm text-gray-300">
													{getFilename(link.url)}
												</span>
												<span className="text-xs text-gray-400">
													{formatSize(link.size)}
												</span>
											</div>
											<button
												onClick={() => handleDelete(link)}
												className="haptic-sm shrink-0 rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
											>
												Delete
											</button>
										</div>
									);
								})}
							</div>
						</div>
					))}
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
