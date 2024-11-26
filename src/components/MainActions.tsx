import { RealDebridUser } from '@/hooks/auth';
import Link from 'next/link';

interface MainActionsProps {
	rdUser: RealDebridUser | null;
	showSettings: () => void;
}

export function MainActions({ rdUser, showSettings }: MainActionsProps) {
	return (
		<div className="grid w-full grid-cols-2 gap-3">
			<Link
				href="/library"
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-cyan-500 bg-cyan-900/30 p-3 text-cyan-100 transition-colors hover:bg-cyan-800/50"
			>
				<span>📚</span> Library
			</Link>
			<Link
				href="https://hashlists.debridmediamanager.com"
				target="_blank"
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-indigo-500 bg-indigo-900/30 p-3 text-indigo-100 transition-colors hover:bg-indigo-800/50"
			>
				🚀 Hash lists
			</Link>
			{rdUser && (
				<Link
					href="/stremio"
					className="haptic flex items-center justify-center gap-2 rounded border-2 border-purple-500 bg-purple-900/30 p-3 text-purple-100 transition-colors hover:bg-purple-800/50"
				>
					<span>🔮</span> Stremio
				</Link>
			)}
			<Link
				href=""
				onClick={showSettings}
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-gray-500 bg-gray-900/30 p-3 text-gray-100 transition-colors hover:bg-gray-800/50"
			>
				⚙️ Settings
			</Link>
		</div>
	);
}
