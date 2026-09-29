import { AlertTriangle } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';

// Each provider's Stremio index page shows this card, in these colours, when
// its credential is missing. The manage pages used to show "loading..."
// forever instead, since a key that is absent from localStorage never arrives.
const STYLES = {
	realdebrid: {
		card: 'border-red-500 bg-red-900/20',
		accent: 'text-red-400',
		button: 'border-green-500 bg-green-800/30 text-green-100 hover:bg-green-700/50',
	},
	alldebrid: {
		card: 'border-red-500 bg-red-900/20',
		accent: 'text-red-400',
		button: 'border-yellow-500 bg-yellow-800/30 text-yellow-100 hover:bg-yellow-700/50',
	},
	torbox: {
		card: 'border-red-500 bg-red-900/20',
		accent: 'text-red-400',
		button: 'border-purple-500 bg-purple-800/30 text-purple-100 hover:bg-purple-700/50',
	},
	premiumize: {
		card: 'border-red-500 bg-red-900/20',
		accent: 'text-red-400',
		button: 'border-red-500 bg-red-800/30 text-red-100 hover:bg-red-700/50',
	},
	offcloud: {
		card: 'border-orange-500 bg-orange-900/20',
		accent: 'text-orange-400',
		button: 'border-orange-500 bg-orange-800/30 text-orange-100 hover:bg-orange-700/50',
	},
	debridlink: {
		card: 'border-sky-500 bg-sky-900/20',
		accent: 'text-sky-400',
		button: 'border-sky-500 bg-sky-800/30 text-sky-100 hover:bg-sky-700/50',
	},
} as const;

export type CastProvider = keyof typeof STYLES;

export function CastLoginRequired({
	provider,
	name,
	returnPath,
	title,
}: {
	provider: CastProvider;
	name: string;
	returnPath: string;
	title: string;
}) {
	const style = STYLES[provider];
	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
			<Head>
				<title>{title}</title>
			</Head>
			<div className={`max-w-md rounded-lg border-2 p-6 text-center ${style.card}`}>
				<AlertTriangle className={`mx-auto mb-4 h-12 w-12 ${style.accent}`} />
				<h1 className={`mb-3 text-2xl font-bold ${style.accent}`}>{name} Required</h1>
				<p className="mb-4 text-gray-300">
					You must be logged in with {name} to manage your casted links.
				</p>
				<Link
					href={`/${provider}/login?redirect=${encodeURIComponent(returnPath)}`}
					className={`haptic-sm inline-block rounded border-2 px-6 py-2 font-medium transition-colors ${style.button}`}
				>
					Login with {name}
				</Link>
			</div>
		</div>
	);
}
