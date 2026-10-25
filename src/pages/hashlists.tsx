import { ChevronLeft, ChevronRight, Home, Shuffle } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';

interface GitHubFile {
	name: string;
	download_url: string;
}

interface HashlistNavState {
	files: string[]; // download_urls
	names: string[]; // file names
	currentIndex: number;
}

export default function HashlistsPage() {
	const router = useRouter();
	const [files, setFiles] = useState<GitHubFile[]>([]);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [loading, setLoading] = useState(true);
	const [loadingHash, setLoadingHash] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		async function fetchHashlists() {
			try {
				const response = await fetch(
					'https://api.github.com/repos/debridmediamanager/hashlists/contents'
				);
				if (!response.ok) {
					throw new Error('Failed to fetch hashlists');
				}
				const data = await response.json();
				const htmlFiles = data.filter(
					(file: GitHubFile) => file.name.endsWith('.html') && file.name !== 'index.html'
				);
				setFiles(htmlFiles);
				if (htmlFiles.length > 0) {
					// Start with a random file
					const randomIndex = Math.floor(Math.random() * htmlFiles.length);
					setCurrentIndex(randomIndex);
					loadHashlist(htmlFiles, randomIndex);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to load hashlists');
			} finally {
				setLoading(false);
			}
		}
		fetchHashlists();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function loadHashlist(fileList: GitHubFile[], index: number) {
		const file = fileList[index];
		if (!file) return;

		setLoadingHash(true);
		try {
			const response = await fetch(file.download_url);
			const html = await response.text();
			// Extract the hash from the iframe src
			const match = html.match(/src="https:\/\/debridmediamanager\.com\/hashlist#([^"]+)"/);
			if (match && match[1]) {
				// Store navigation state in sessionStorage
				const navState: HashlistNavState = {
					files: fileList.map((f) => f.download_url),
					names: fileList.map((f) => f.name),
					currentIndex: index,
				};
				sessionStorage.setItem('hashlistNav', JSON.stringify(navState));
				router.push(`/hashlist#${match[1]}`);
			} else {
				setError('Could not extract hashlist data');
				setLoadingHash(false);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load hashlist');
			setLoadingHash(false);
		}
	}

	const handlePrevious = useCallback(() => {
		const newIndex = Math.max(0, currentIndex - 1);
		setCurrentIndex(newIndex);
		loadHashlist(files, newIndex);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentIndex, files]);

	const handleNext = useCallback(() => {
		const newIndex = Math.min(files.length - 1, currentIndex + 1);
		setCurrentIndex(newIndex);
		loadHashlist(files, newIndex);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentIndex, files]);

	const handleRandom = useCallback(() => {
		if (files.length <= 1) return;
		let newIndex;
		do {
			newIndex = Math.floor(Math.random() * files.length);
		} while (newIndex === currentIndex);
		setCurrentIndex(newIndex);
		loadHashlist(files, newIndex);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [files, currentIndex]);

	const currentFile = files[currentIndex];

	return (
		<div className="flex h-screen flex-col items-center justify-center bg-gray-900">
			<Head>
				<title>Debrid Media Manager - Hash Lists</title>
			</Head>

			{/* Control Panel */}
			<div className="flex w-full max-w-md flex-col items-center gap-4 p-4">
				<h1 className="text-xl font-bold text-white">Hash Lists Browser</h1>

				<div className="flex items-center gap-2">
					<Link
						href="/"
						className="rounded border-2 border-cyan-500 bg-cyan-900/30 p-2 text-cyan-100 transition-colors hover:bg-cyan-800/50"
						title="Go Home"
						aria-label="Go Home"
					>
						<Home className="h-4 w-4" />
					</Link>
					<button
						onClick={handlePrevious}
						disabled={currentIndex <= 0 || loading || loadingHash}
						className={`rounded border-2 border-indigo-500 bg-indigo-900/30 p-2 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
							currentIndex <= 0 || loading || loadingHash
								? 'cursor-not-allowed opacity-50'
								: ''
						}`}
						title="Previous"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<button
						onClick={handleRandom}
						disabled={files.length <= 1 || loading || loadingHash}
						className={`rounded border-2 border-purple-500 bg-purple-900/30 p-2 text-purple-100 transition-colors hover:bg-purple-800/50 ${
							files.length <= 1 || loading || loadingHash
								? 'cursor-not-allowed opacity-50'
								: ''
						}`}
						title="Random"
					>
						<Shuffle className="h-4 w-4" />
					</button>
					<button
						onClick={handleNext}
						disabled={currentIndex >= files.length - 1 || loading || loadingHash}
						className={`rounded border-2 border-indigo-500 bg-indigo-900/30 p-2 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
							currentIndex >= files.length - 1 || loading || loadingHash
								? 'cursor-not-allowed opacity-50'
								: ''
						}`}
						title="Next"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
				</div>

				<div className="text-center text-sm text-gray-300">
					{loading ? (
						'Loading hashlists...'
					) : loadingHash ? (
						'Loading hashlist...'
					) : error ? (
						<span className="text-red-400">{error}</span>
					) : currentFile ? (
						<span>
							{currentFile.name} ({currentIndex + 1}/{files.length})
						</span>
					) : (
						'No hashlists found'
					)}
				</div>
			</div>
		</div>
	);
}
