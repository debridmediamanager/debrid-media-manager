import { RealDebridUser } from '@/hooks/auth';
import Link from 'next/link';

interface MainActionsProps {
	rdUser: RealDebridUser | null;
	showSettings: () => void;
}

export function MainActions({ rdUser, showSettings }: MainActionsProps) {
	return (
		<div className="grid grid-cols-2 gap-3 w-full">
			<Link
				href="/library"
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 transition-colors haptic"
			>
				<span>📚</span> Library
			</Link>
			<Link
				href="/search"
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-fuchsia-500 bg-fuchsia-900/30 text-fuchsia-100 hover:bg-fuchsia-800/50 transition-colors haptic"
			>
				<span>🔎</span> Search
			</Link>
			<Link
				href="https://hashlists.debridmediamanager.com"
				target="_blank"
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-indigo-500 bg-indigo-900/30 text-indigo-100 hover:bg-indigo-800/50 transition-colors haptic"
			>
				🚀 Hash lists
			</Link>
			<Link
				href="/animesearch"
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-pink-500 bg-pink-900/30 text-pink-100 hover:bg-pink-800/50 transition-colors haptic"
			>
				<span>🌸</span> Anime
			</Link>
			{rdUser && (
				<Link
					href="/stremio"
					className="flex items-center justify-center gap-2 p-3 rounded border-2 border-purple-500 bg-purple-900/30 text-purple-100 hover:bg-purple-800/50 transition-colors haptic"
				>
					<span>🔮</span> Stremio
				</Link>
			)}
			<Link
				href=""
				onClick={showSettings}
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 transition-colors haptic"
			>
				⚙️ Settings
			</Link>
		</div>
	);
}
