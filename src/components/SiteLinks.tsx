// The other sites in the family, so each can be reached from DMM. Sponsoring and
// Discord stay with the info card: one sponsorship offer per page.
export const SITE_LINKS = [
	{ label: 'zurg', href: 'https://zurg.debridmediamanager.com/' },
	{ label: 'rex', href: 'https://rex.debridmediamanager.com/' },
	{ label: 'Guides', href: 'https://notes.debridmediamanager.com/' },
];

export function SiteLinks() {
	return (
		<nav
			aria-label="Other DMM sites"
			className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm"
		>
			<span className="text-gray-400">More from DMM:</span>
			{SITE_LINKS.map(({ label, href }) => (
				<a
					key={href}
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className="text-blue-300 underline hover:text-blue-200"
				>
					{label}
				</a>
			))}
		</nav>
	);
}
