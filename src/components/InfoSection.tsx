import { useSponsor } from '@/hooks/useSponsor';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';
import { Handshake } from 'lucide-react';
import Link from 'next/link';
import { SponsorBadge } from './SponsorBadge';

const linkClass = 'text-blue-300 underline hover:text-blue-200';

const EXTENSIONS = [
	{
		label: 'Chrome',
		href: 'https://chromewebstore.google.com/detail/Debrid%20Media%20Manager/oeojlegjfhgefhnbjdnaebgdfkbipghm',
	},
	{
		label: 'Firefox',
		href: 'https://addons.mozilla.org/en-US/firefox/addon/debrid-media-manager/',
	},
	{
		label: 'Safari (Userscripts app)',
		href: 'https://apps.apple.com/us/app/userscripts/id1463298887',
	},
	{ label: 'userscript', href: 'https://greasyfork.org/en/scripts/463268-debrid-media-manager' },
];

// Community and extension links, appended to the "More from DMM" row. The
// extensions fold into one entry; opening it lists every store.
export function CommunityLinks() {
	return (
		<>
			<a
				className={linkClass}
				href="https://discord.gg/7u4YjMThXP"
				target="_blank"
				rel="noopener noreferrer"
			>
				Discord
			</a>
			<a
				className={linkClass}
				href="https://www.reddit.com/r/debridmediamanager/"
				target="_blank"
				rel="noopener noreferrer"
			>
				r/debridmediamanager
			</a>
			<details className="relative">
				<summary className={`cursor-pointer list-none ${linkClass}`}>Extensions</summary>
				<div className="absolute right-0 z-20 mt-1 flex flex-col gap-1 rounded border border-gray-600 bg-gray-800 px-3 py-2 text-left whitespace-nowrap shadow-lg">
					{EXTENSIONS.map(({ label, href }) => (
						<a
							key={href}
							className={linkClass}
							href={href}
							target="_blank"
							rel="noopener noreferrer"
						>
							{label}
						</a>
					))}
				</div>
			</details>
		</>
	);
}

export function InfoSection() {
	const { isSponsor } = useSponsor();

	return (
		<div className="w-full rounded border-2 border-gray-600 bg-gray-800/50 p-3 text-center text-sm text-gray-100">
			{isSponsor ? (
				<div className="flex items-center justify-center gap-2">
					<SponsorBadge />
					<span className="text-gray-300">Thank you for supporting DMM</span>
				</div>
			) : (
				<div>
					<Handshake className="mr-1 inline-block h-3 w-3 text-blue-400" />
					Sponsor this project&apos;s development on{' '}
					<a
						className={linkClass}
						href={GATEKEEPER_URL}
						target="_blank"
						rel="noopener noreferrer"
					>
						gatekeeper
					</a>
					<div className="mt-1 text-xs text-gray-400">
						Already sponsoring? Get your DMM API key there and paste it in{' '}
						<Link href="/settings" className={linkClass}>
							Settings
						</Link>{' '}
						to unlock the indexers and the raised cast limits.
					</div>
				</div>
			)}
		</div>
	);
}
