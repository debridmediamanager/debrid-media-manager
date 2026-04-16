import Image from 'next/image';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

// Pre-compute subdomain based on IMDB ID (deterministic hash)
const getPosterUrl = (imdbId: string | null | undefined): string => {
	if (!imdbId) return '';

	const numericId = imdbId.replace(/[^0-9]/g, '');
	let hash = 0;
	for (let i = 0; i < numericId.length; i++) {
		hash = (hash << 5) - hash + parseInt(numericId[i]);
		hash = hash & hash;
	}

	const subdomain = Math.abs(hash) % 10;
	return `https://posters${subdomain}.debridmediamanager.com/${imdbId}-small.jpg`;
};

// Stremio's poster CDN (same source Cinemeta serves). Good coverage for
// the long tail that Fanart/TMDB sometimes miss, and deterministic by IMDb ID.
const getMetahubUrl = (imdbId: string): string =>
	`https://images.metahub.space/poster/small/${imdbId}/img`;

const getPlaceholderUrl = (text: string): string => {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const w of words) {
		const next = line ? `${line} ${w}` : w;
		if (next.length > 16 && line) {
			lines.push(line);
			line = w;
		} else {
			line = next;
		}
		if (lines.length >= 3) break;
	}
	if (line && lines.length < 4) lines.push(line);
	const safe = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const tspans = lines
		.map((l, i) => `<tspan x="200" dy="${i === 0 ? 0 : 40}">${safe(l)}</tspan>`)
		.join('');
	const yStart = 300 - (lines.length - 1) * 20;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="#282828"/><text x="200" y="${yStart}" fill="#eae0d0" font-family="sans-serif" font-size="32" font-weight="600" text-anchor="middle">${tspans}</text></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

// Cache for resolved poster URLs to avoid duplicate lookups
const posterCache = new Map<string, string>();

type FallbackStep = 'cdn' | 'metahub' | 'api' | 'placeholder';

type PosterProps = {
	imdbId: string;
	title?: string;
};

const Poster = memo(
	function Poster({ imdbId, title }: PosterProps) {
		const [posterUrl, setPosterUrl] = useState(() => getPosterUrl(imdbId));
		const [step, setStep] = useState<FallbackStep>('cdn');
		const mountedRef = useRef(true);

		useEffect(() => {
			mountedRef.current = true;
			return () => {
				mountedRef.current = false;
			};
		}, []);

		useEffect(() => {
			if (imdbId) {
				// Check cache first
				const cached = posterCache.get(imdbId);
				if (cached) {
					setPosterUrl(cached);
					setStep('placeholder');
				} else {
					setPosterUrl(getPosterUrl(imdbId));
					setStep('cdn');
				}
			}
		}, [imdbId]);

		const handleImageError = useCallback(async () => {
			if (!imdbId) return;

			const cached = posterCache.get(imdbId);
			if (cached && cached !== posterUrl) {
				setPosterUrl(cached);
				setStep('placeholder');
				return;
			}

			if (step === 'cdn') {
				setStep('metahub');
				setPosterUrl(getMetahubUrl(imdbId));
				return;
			}

			if (step === 'metahub') {
				setStep('api');
				try {
					const response = await fetch(`/api/poster?imdbid=${imdbId}`);
					if (response.ok && mountedRef.current) {
						const data = await response.json();
						if (data?.url) {
							posterCache.set(imdbId, data.url);
							setPosterUrl(data.url);
							return;
						}
					}
					throw new Error('API failed');
				} catch {
					if (!mountedRef.current) return;
					const placeholder = getPlaceholderUrl(title || imdbId || 'No Poster');
					posterCache.set(imdbId, placeholder);
					setPosterUrl(placeholder);
					setStep('placeholder');
				}
				return;
			}

			if (step === 'api') {
				const placeholder = getPlaceholderUrl(title || imdbId || 'No Poster');
				posterCache.set(imdbId, placeholder);
				setPosterUrl(placeholder);
				setStep('placeholder');
			}
		}, [step, imdbId, title, posterUrl]);

		return (
			<div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-gray-800">
				{posterUrl ? (
					<Image
						fill
						sizes="80px"
						src={posterUrl}
						alt={`Poster for ${title || imdbId || 'unknown'}`}
						loading="lazy"
						onError={handleImageError}
						className="object-cover"
					/>
				) : (
					<div className="absolute inset-0 flex items-center justify-center text-gray-600">
						<div className="p-2 text-center text-sm">Loading...</div>
					</div>
				)}
			</div>
		);
	},
	// Custom comparison - only re-render if imdbId or title changes
	(prevProps, nextProps) =>
		prevProps.imdbId === nextProps.imdbId && (prevProps.title ?? '') === (nextProps.title ?? '')
);

export default Poster;
