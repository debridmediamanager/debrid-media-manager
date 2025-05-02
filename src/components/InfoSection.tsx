export function InfoSection() {
	return (
		<div className="space-y-3 text-center text-sm">
			<div className="rounded border-2 border-gray-600 bg-gray-800/50 p-4 text-gray-100">
				<div className="mb-1 text-center text-sm">
					✨ Get DMM browser extensions for{' '}
					<b>
						<a
							className="text-blue-300 underline hover:text-blue-200"
							href="https://chromewebstore.google.com/detail/debrid-media-manager/fahmnboccjgkbeeianfdiohbbgmgoibb"
							target="_blank"
						>
							Chrome
						</a>
					</b>{' '}
					and{' '}
					<b>
						<a
							className="text-blue-300 underline hover:text-blue-200"
							href="https://addons.mozilla.org/en-US/firefox/addon/debrid-media-manager/"
							target="_blank"
						>
							Firefox
						</a>
					</b>{' '}
					or{' '}
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://apps.apple.com/us/app/userscripts/id1463298887"
						target="_blank"
					>
						Safari
					</a>{' '}
					with the{' '}
					<b>
						<a
							className="text-blue-300 underline hover:text-blue-200"
							href="https://greasyfork.org/en/scripts/463268-debrid-media-manager"
							target="_blank"
						>
							userscript
						</a>
					</b>
				</div>

				<div className="mb-1 text-center text-sm">
					✨
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://github.com/debridmediamanager/zurg-testing"
						target="_blank"
					>
						<b>zurg</b>
					</a>{' '}
					mounts your Real-Debrid library and play your files directly from your computer
					or with Plex
				</div>
				<div className="mb-1 text-center text-sm">
					✨
					<a
						className="text-azure bg-red-500 px-1 text-red-100"
						href="https://www.reddit.com/r/debridmediamanager/"
						target="_blank"
					>
						r/debridmediamanager
					</a>{' '}
					🤝 Sponsor this project&apos;s development on{' '}
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://github.com/sponsors/debridmediamanager"
						target="_blank"
					>
						Github
					</a>{' '}
					|{' '}
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://www.patreon.com/debridmediamanager"
						target="_blank"
					>
						Patreon
					</a>{' '}
					|{' '}
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://paypal.me/yowmamasita"
						target="_blank"
					>
						Paypal
					</a>
				</div>
				<div className="mb-1 text-center text-sm">
					✨ Lastly... we now have a{' '}
					<a
						className="text-blue-300 underline hover:text-blue-200"
						href="https://discord.gg/7u4YjMThXP"
						target="_blank"
					>
						<b>Discord</b>
					</a>{' '}
					community
				</div>
			</div>
		</div>
	);
}
