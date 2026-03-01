import { RealDebridUser } from '@/hooks/auth';
import { TorBoxUser } from '@/services/types';
import { BookOpen, Music2, Rocket, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface MainActionsProps {
	rdUser: RealDebridUser | null;
	tbUser: TorBoxUser | null;
	adUser: boolean;
	isLoading: boolean;
}

const isLocalDev = process.env.NODE_ENV === 'development';

export function MainActions({ rdUser, tbUser, adUser, isLoading }: MainActionsProps) {
	const castButtons = [
		rdUser && {
			href: '/stremio',
			label: 'Cast for RD',
			borderColor: 'border-green-500',
			bgColor: 'bg-green-900/30',
			hoverColor: 'hover:bg-green-800/50',
			textColor: 'text-green-100',
			iconColor: 'text-green-400',
		},
		tbUser && {
			href: '/stremio-torbox',
			label: 'Cast for TB',
			borderColor: 'border-purple-500',
			bgColor: 'bg-purple-900/30',
			hoverColor: 'hover:bg-purple-800/50',
			textColor: 'text-purple-100',
			iconColor: 'text-purple-400',
		},
		adUser && {
			href: '/stremio-alldebrid',
			label: 'Cast for AD',
			borderColor: 'border-yellow-500',
			bgColor: 'bg-yellow-900/30',
			hoverColor: 'hover:bg-yellow-800/50',
			textColor: 'text-yellow-100',
			iconColor: 'text-yellow-400',
		},
	].filter(Boolean) as {
		href: string;
		label: string;
		borderColor: string;
		bgColor: string;
		hoverColor: string;
		textColor: string;
		iconColor: string;
	}[];

	const castGridCols =
		castButtons.length === 1
			? 'grid-cols-1'
			: castButtons.length === 2
				? 'grid-cols-2'
				: 'grid-cols-3';

	return (
		<div className="flex w-full flex-col gap-3">
			{/* First row: Library, Hash lists, Is RD Down */}
			<div className="grid w-full grid-cols-3 gap-3">
				<Link
					href="/library"
					className="haptic flex items-center justify-center gap-2 rounded border-2 border-cyan-500 bg-cyan-900/30 p-3 text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					<BookOpen className="mr-1 inline-block h-4 w-4 text-cyan-400" />
					Library
				</Link>
				<Link
					href={isLocalDev ? '/hashlists' : 'https://hashlists.debridmediamanager.com'}
					target={isLocalDev ? undefined : '_blank'}
					className="haptic flex items-center justify-center gap-2 rounded border-2 border-indigo-500 bg-indigo-900/30 p-3 text-indigo-100 transition-colors hover:bg-indigo-800/50"
				>
					<Rocket className="mr-1 inline-block h-4 w-4 text-indigo-400" />
					Hash lists
				</Link>
				<Link
					href="/albums"
					className="haptic flex items-center justify-center gap-2 rounded border-2 border-green-500 bg-green-900/30 p-3 text-green-100 transition-colors hover:bg-green-800/50"
				>
					<Music2 className="mr-1 inline-block h-4 w-4 text-green-400" />
					Music
				</Link>
			</div>

			{/* Second row: Cast buttons */}
			{castButtons.length > 0 && (
				<div className={`grid w-full gap-3 ${castGridCols}`}>
					{castButtons.map((button) => (
						<Link
							key={button.href}
							href={button.href}
							className={`haptic flex items-center justify-center gap-2 rounded border-2 ${button.borderColor} ${button.bgColor} p-3 ${button.textColor} transition-colors ${button.hoverColor}`}
						>
							<Sparkles className={`mr-1 inline-block h-4 w-4 ${button.iconColor}`} />
							{button.label}
						</Link>
					))}
				</div>
			)}

			{/* Is RD Down - full width */}
			{rdUser && (
				<Link
					href="/is-real-debrid-down-or-just-me"
					className="haptic flex w-full items-center justify-center rounded border-2 border-emerald-500 bg-emerald-900/30 p-3 text-center text-sm text-emerald-100 transition-colors hover:bg-emerald-800/40"
				>
					Is Real-Debrid down or just me?
				</Link>
			)}
		</div>
	);
}
