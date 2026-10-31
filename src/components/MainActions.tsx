import { RealDebridUser } from '@/hooks/auth';
import { TorBoxUser } from '@/services/types';
import { BookOpen, HandHeart, Music2, Rocket, Send, Sparkles, Tv } from 'lucide-react';
import Link from 'next/link';

interface MainActionsProps {
	rdUser: RealDebridUser | null;
	tbUser: TorBoxUser | null;
	adUser: boolean;
	pmUser: boolean;
	ocUser: boolean;
	dlUser: boolean;
	isLoading: boolean;
	/** No debrid account connected: the library has nothing to list. */
	isGuest?: boolean;
}

const isLocalDev = process.env.NODE_ENV === 'development';

export function MainActions({
	rdUser,
	tbUser,
	adUser,
	pmUser,
	ocUser,
	dlUser,
	isLoading,
	isGuest = false,
}: MainActionsProps) {
	const castButtons = [
		rdUser && {
			href: '/stremio',
			label: 'Cast for RD',
			code: 'RD',
			chipClass: 'border-[#b5d496] bg-[#b5d496]/10 text-[#b5d496] hover:bg-[#b5d496]/25',
			borderColor: 'border-green-500',
			bgColor: 'bg-green-900/30',
			hoverColor: 'hover:bg-green-800/50',
			textColor: 'text-green-100',
			iconColor: 'text-green-400',
		},
		tbUser && {
			href: '/stremio-torbox',
			label: 'Cast for TB',
			code: 'TB',
			chipClass: 'border-[#4f46e5] bg-[#4f46e5]/20 text-[#a5b4fc] hover:bg-[#4f46e5]/40',
			borderColor: 'border-purple-500',
			bgColor: 'bg-purple-900/30',
			hoverColor: 'hover:bg-purple-800/50',
			textColor: 'text-purple-100',
			iconColor: 'text-purple-400',
		},
		adUser && {
			href: '/stremio-alldebrid',
			label: 'Cast for AD',
			code: 'AD',
			chipClass: 'border-[#fbc730] bg-[#fbc730]/10 text-[#fbc730] hover:bg-[#fbc730]/25',
			borderColor: 'border-yellow-500',
			bgColor: 'bg-yellow-900/30',
			hoverColor: 'hover:bg-yellow-800/50',
			textColor: 'text-yellow-100',
			iconColor: 'text-yellow-400',
		},
		pmUser && {
			href: '/stremio-premiumize',
			label: 'Cast for PM',
			code: 'PM',
			chipClass: 'border-[#aa0000] bg-[#aa0000]/20 text-[#f2a0a0] hover:bg-[#aa0000]/40',
			borderColor: 'border-red-500',
			bgColor: 'bg-red-900/30',
			hoverColor: 'hover:bg-red-800/50',
			textColor: 'text-red-100',
			iconColor: 'text-red-400',
		},
		ocUser && {
			href: '/stremio-offcloud',
			label: 'Cast for OC',
			code: 'OC',
			chipClass: 'border-[#f97316] bg-[#f97316]/10 text-[#f97316] hover:bg-[#f97316]/25',
			borderColor: 'border-orange-500',
			bgColor: 'bg-orange-900/30',
			hoverColor: 'hover:bg-orange-800/50',
			textColor: 'text-orange-100',
			iconColor: 'text-orange-400',
		},
		dlUser && {
			href: '/stremio-debridlink',
			label: 'Cast for DL',
			code: 'DL',
			chipClass: 'border-[#38bdf8] bg-[#38bdf8]/10 text-[#38bdf8] hover:bg-[#38bdf8]/25',
			borderColor: 'border-sky-500',
			bgColor: 'bg-sky-900/30',
			hoverColor: 'hover:bg-sky-800/50',
			textColor: 'text-sky-100',
			iconColor: 'text-sky-400',
		},
	].filter(Boolean) as {
		href: string;
		label: string;
		code: string;
		chipClass: string;
		borderColor: string;
		bgColor: string;
		hoverColor: string;
		textColor: string;
		iconColor: string;
	}[];

	return (
		<div className="flex w-full flex-col gap-3">
			{/* First row: Library, Hash lists, Music. Two of the three need a
			    provider account and dead-end without one - the library because
			    `withAuth` sends a guest straight back from it, and Music because
			    the albums page pushes anyone with no Real-Debrid token into
			    /realdebrid/login, which is the exact flow guest mode exists to
			    skip. Hash lists is the one that works either way, so a guest
			    gets it full width rather than a row with two holes in it. */}
			<div className={`grid w-full gap-3 ${isGuest ? 'grid-cols-1' : 'grid-cols-3'}`}>
				{!isGuest && (
					<Link
						href="/library"
						className="haptic flex items-center justify-center gap-2 rounded border-2 border-cyan-500 bg-cyan-900/30 px-1 py-3 whitespace-nowrap text-cyan-100 transition-colors hover:bg-cyan-800/50 sm:p-3"
					>
						<BookOpen className="mr-1 hidden h-4 w-4 text-cyan-400 sm:inline-block" />
						Library
					</Link>
				)}
				<Link
					href={isLocalDev ? '/hashlists' : 'https://hashlists.debridmediamanager.com'}
					target={isLocalDev ? undefined : '_blank'}
					className="haptic flex items-center justify-center gap-2 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-3 whitespace-nowrap text-indigo-100 transition-colors hover:bg-indigo-800/50 sm:p-3"
				>
					<Rocket className="mr-1 hidden h-4 w-4 text-indigo-400 sm:inline-block" />
					Hash lists
				</Link>
				{!isGuest && (
					<Link
						href="/albums"
						className="haptic flex items-center justify-center gap-2 rounded border-2 border-green-500 bg-green-900/30 px-1 py-3 whitespace-nowrap text-green-100 transition-colors hover:bg-green-800/50 sm:p-3"
					>
						<Music2 className="mr-1 hidden h-4 w-4 text-green-400 sm:inline-block" />
						Music
					</Link>
				)}
			</div>

			{/* Second row: Cast. One provider keeps its full button; two or more
			    share one row of provider chips, which used to take up to two
			    rows of six "Cast for XX" buttons. */}
			{castButtons.length === 1 &&
				castButtons.map((button) => (
					<Link
						key={button.href}
						href={button.href}
						className={`haptic flex items-center justify-center gap-2 rounded border-2 ${button.borderColor} ${button.bgColor} p-3 ${button.textColor} transition-colors ${button.hoverColor}`}
					>
						<Sparkles className={`mr-1 inline-block h-4 w-4 ${button.iconColor}`} />
						{button.label}
					</Link>
				))}
			{castButtons.length > 1 && (
				<div className="flex w-full items-center gap-2">
					<span className="flex items-center gap-1 pr-1 text-sm text-gray-300">
						<Sparkles className="h-4 w-4 text-gray-400" aria-hidden="true" />
						Cast
					</span>
					{castButtons.map((button) => (
						<Link
							key={button.href}
							href={button.href}
							aria-label={button.label}
							title={button.label}
							className={`haptic flex min-w-0 flex-1 items-center justify-center rounded border-2 py-2 text-sm font-semibold transition-colors ${button.chipClass}`}
						>
							{button.code}
						</Link>
					))}
				</div>
			)}

			{castButtons.length > 0 && (
				<Link
					href="/kodi"
					className="haptic flex items-center justify-center gap-2 rounded border-2 border-gray-500 bg-gray-800/30 p-2 text-sm text-gray-100 transition-colors hover:bg-gray-700/50"
				>
					<Tv className="h-4 w-4 text-gray-400" />
					Watch in Kodi
				</Link>
			)}

			{/* Transfers and Requests share a row. Transfers is where a Real-Debrid
			    user watches content arrive. Requests serves both sides: a TorBox
			    user picks up somebody else's ask there, and a Real-Debrid user
			    follows their own asks there, which is the only place that says
			    whether one was sent or failed. AllDebrid stopped being a source on
			    2026-09-01, so an AllDebrid-only user has nothing to do there.
			    Premiumize, Offcloud and Debrid-Link are deliberately not here: the
			    uploader cannot source a transfer from any of them, so those users
			    have nothing to fulfil with — which is why neither Offcloud nor
			    Debrid-Link reaches the gate below. A user who is both sees the pair side by side; a user who is only one
			    sees that one full-width rather than stranded in half a row. */}
			{(rdUser || tbUser) && (
				<div className={`grid w-full gap-3 ${rdUser ? 'grid-cols-2' : 'grid-cols-1'}`}>
					{rdUser && (
						<Link
							href="/transfers"
							className="haptic flex items-center justify-center rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-3 text-center text-sm whitespace-nowrap text-indigo-100 transition-colors hover:bg-indigo-800/50 sm:p-3"
						>
							<Send className="mr-2 hidden h-4 w-4 text-indigo-400 sm:inline-block" />
							Transfers
						</Link>
					)}
					{(rdUser || tbUser) && (
						<Link
							href="/requests"
							className="haptic flex items-center justify-center rounded border-2 border-cyan-500 bg-cyan-900/30 px-1 py-3 text-center text-sm whitespace-nowrap text-cyan-100 transition-colors hover:bg-cyan-800/50 sm:p-3"
						>
							<HandHeart className="mr-2 hidden h-4 w-4 text-cyan-400 sm:inline-block" />
							Requests
						</Link>
					)}
				</div>
			)}

			{/* The status pages are a line of text, not a row of buttons: they are
			    checked when something seems wrong, not every visit. Either can be
			    absent - a user with no TorBox account never sees its page. */}
			{(rdUser || tbUser) && (
				<p className="text-center text-xs text-gray-400">
					Status:{' '}
					{rdUser && (
						<Link
							href="/is-real-debrid-down-or-just-me"
							title="Is Real-Debrid down or just me?"
							className="text-blue-300 underline hover:text-blue-200"
						>
							Real-Debrid
						</Link>
					)}
					{rdUser && tbUser && ' · '}
					{tbUser && (
						<Link
							href="/is-torbox-down-or-just-me"
							title="Is TorBox down or just me?"
							className="text-blue-300 underline hover:text-blue-200"
						>
							TorBox
						</Link>
					)}
				</p>
			)}
		</div>
	);
}
