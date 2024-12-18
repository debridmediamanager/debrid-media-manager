import axios from 'axios';
import getConfig from 'next/config';
import { useRouter } from 'next/router';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Poster from './poster';

const { publicRuntimeConfig: config } = getConfig();

type RelatedMediaProps = {
	imdbId: string;
	mediaType: 'movie' | 'show';
};

type MediaItem = {
	title: string;
	year: number;
	ids: {
		imdb: string;
	};
};

export default function RelatedMedia({ imdbId, mediaType }: RelatedMediaProps) {
	const router = useRouter();
	const [showRelated, setShowRelated] = useState(false);
	const [relatedMedia, setRelatedMedia] = useState<MediaItem[]>([]);

	const handleItemClick = (e: React.MouseEvent, itemImdbId: string) => {
		const path = `/${mediaType}/${itemImdbId}${mediaType === 'show' ? '/1' : ''}`;
		if (e.ctrlKey || e.metaKey) {
			// Open in new tab if ctrl/cmd is pressed
			window.open(path, '_blank');
		} else {
			// Force page reload in current tab
			window.location.href = path;
		}
	};

	const fetchRelatedMedia = async () => {
		if (!imdbId) return;
		try {
			const response = await axios.get(
				`https://api.trakt.tv/${mediaType}s/${imdbId}/related`,
				{
					headers: {
						'Content-Type': 'application/json',
						'trakt-api-version': '2',
						'trakt-api-key': config.traktClientId,
					},
				}
			);
			setRelatedMedia(response.data);
		} catch (error) {
			console.error(`Failed to fetch related ${mediaType}s:`, error);
			toast.error(`Failed to load related ${mediaType}s`);
		}
	};

	return (
		<>
			<button
				className="mb-1 mr-2 mt-0 rounded border-2 border-indigo-500 bg-indigo-900/30 p-1 text-xs text-indigo-100 transition-colors hover:bg-indigo-800/50"
				onClick={() => {
					if (!showRelated) {
						fetchRelatedMedia();
					}
					setShowRelated(!showRelated);
				}}
			>
				<b>{showRelated ? '🍿Hide Related' : '🍿Show Related'}</b>
			</button>

			{showRelated && (
				<div className="mt-4 bg-gray-800/50 p-4">
					<h3 className="mb-4 text-lg font-bold text-gray-100">
						Related {mediaType === 'movie' ? 'Movies' : 'Shows'}
					</h3>
					<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
						{relatedMedia.map((item) => (
							<div
								key={item.ids.imdb}
								onClick={(e) => handleItemClick(e, item.ids.imdb)}
								className="cursor-pointer transition-transform hover:scale-105"
							>
								<div className="flex flex-col items-center">
									<Poster imdbId={item.ids.imdb} title={item.title} />
									<div className="mt-2 text-center">
										<div className="text-sm font-semibold text-gray-100">
											{item.title}
										</div>
										<div className="text-xs text-gray-400">{item.year}</div>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</>
	);
}
