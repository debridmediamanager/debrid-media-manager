import { RealDebridUser } from '@/hooks/auth';
import { TorBoxUser } from '@/services/types';
import { BookOpen, HandHeart, Music2, Rocket, Send, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface MainActionsProps {
	rdUser: RealDebridUser | null;
	tbUser: TorBoxUser | null;
	adUser: boolean;
	pmUser: boolean;
	isLoading: boolean;
}

const isLocalDev = process.env.NODE_ENV === 'development';

export function MainActions({ rdUser, tbUser, adUser, pmUser, isLoading }: MainActionsProps) {
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
		pmUser && {
			href: '/stremio-premiumize',
			label: 'Cast for PM',
			borderColor: 'border-red-500',
			bgColor: 'bg-red-900/30',
			hoverColor: 'hover:bg-red-800/50',
			textColor: 'text-red-100',
			iconColor: 'text-red-400',
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
				: castButtons.length === 3
					? 'grid-cols-3'
					: 'grid-cols-4';

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

			{/* Transfers and Requests share a row, but they answer to different
			    audiences. Transfers is where a Real-Debrid user watches content
			    arrive, so it is theirs. Requests is where a TorBox or AllDebrid
			    user picks up somebody else's ask, so it is the fulfillers'.
			    Premiumize is deliberately not here: the uploader cannot source a
			    transfer from it, so a Premiumize user has nothing to fulfil with. A
			    user who is both sees the pair side by side; a user who is only one
			    sees that one full-width rather than stranded in half a row. (A
			    Real-Debrid-only user files a request from the search result itself —
			    the button there — and never needs the board.) */}
			{(rdUser || tbUser || adUser) && (
				<div
					className={`grid w-full gap-3 ${rdUser && (tbUser || adUser) ? 'grid-cols-2' : 'grid-cols-1'}`}
				>
					{rdUser && (
						<Link
							href="/transfers"
							className="haptic flex items-center justify-center rounded border-2 border-indigo-500 bg-indigo-900/30 p-3 text-center text-sm text-indigo-100 transition-colors hover:bg-indigo-800/50"
						>
							<Send className="mr-2 inline-block h-4 w-4 text-indigo-400" />
							Transfers
						</Link>
					)}
					{(tbUser || adUser) && (
						<Link
							href="/requests"
							className="haptic flex items-center justify-center rounded border-2 border-cyan-500 bg-cyan-900/30 p-3 text-center text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
						>
							<HandHeart className="mr-2 inline-block h-4 w-4 text-cyan-400" />
							Requests
						</Link>
					)}
				</div>
			)}

			{/* The two status pages share a row. Either can be absent — a user
			    with no TorBox account never sees its page — so the column count
			    follows how many are actually rendered rather than being fixed at
			    two, which would leave a lone button occupying half the row. */}
			{(rdUser || tbUser) && (
				<div
					className={`grid w-full gap-3 ${rdUser && tbUser ? 'grid-cols-2' : 'grid-cols-1'}`}
				>
					{rdUser && (
						<Link
							href="/is-real-debrid-down-or-just-me"
							className="haptic flex items-center justify-center rounded border-2 border-emerald-500 bg-emerald-900/30 p-3 text-center text-sm text-emerald-100 transition-colors hover:bg-emerald-800/40"
						>
							Is Real-Debrid down or just me?
						</Link>
					)}
					{tbUser && (
						<Link
							href="/is-torbox-down-or-just-me"
							className="haptic flex items-center justify-center rounded border-2 border-[#4f46e5] bg-indigo-900/30 p-3 text-center text-sm text-indigo-100 transition-colors hover:bg-indigo-800/40"
						>
							Is TorBox down or just me?
						</Link>
					)}
				</div>
			)}
		</div>
	);
}
