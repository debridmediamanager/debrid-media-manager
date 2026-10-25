import { CastSettingsPanel } from '@/components/CastSettingsPanel';
import { AlertTriangle, Cast, ClipboardList, EyeOff, Globe, Wand2 } from 'lucide-react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { ComponentProps, ReactNode, useState } from 'react';

// Tailwind classes stay complete literals in each provider's config so the
// build can see them.
export interface CastPageConfig {
	name: string;
	service: ComponentProps<typeof CastSettingsPanel>['service'];
	accentColor: ComponentProps<typeof CastSettingsPanel>['accentColor'];
	apiPrefix: string;
	castPath: string;
	loginPath: string;
	logo: string;
	hasCredentials: () => boolean;
	theme: {
		heading: string;
		icon: string;
		button: string;
		buttonText: string;
		alert: string;
		alertBox: string;
	};
	notice?: ReactNode;
}

export function CastPage({
	config,
	dmmCastToken,
}: {
	config: CastPageConfig;
	dmmCastToken: string | null | undefined;
}) {
	const { name, theme } = config;
	const [hasCredentials] = useState(() =>
		typeof window !== 'undefined' ? config.hasCredentials() : false
	);
	const title = `DMM Cast for ${name} - Stremio`;

	if (!hasCredentials) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
				<Head>
					<title>{title}</title>
				</Head>
				<div className={`max-w-md rounded-lg border-2 p-6 text-center ${theme.alertBox}`}>
					<AlertTriangle className={`mx-auto mb-4 h-12 w-12 ${theme.alert}`} />
					<h1 className={`mb-3 text-2xl font-bold ${theme.alert}`}>{name} Required</h1>
					<p className="mb-4 text-gray-300">
						You must be logged in with {name} to use the Stremio Cast feature.
					</p>
					<Link
						href={`${config.loginPath}?redirect=${encodeURIComponent(config.castPath)}`}
						className={`haptic-sm inline-block rounded border-2 px-6 py-2 font-medium transition-colors ${theme.button} ${theme.buttonText}`}
					>
						Login with {name}
					</Link>
				</div>
			</div>
		);
	}

	if (!dmmCastToken) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900">
				<h1 className="text-center text-xl text-white">
					Debrid Media Manager is loading...
				</h1>
			</div>
		);
	}

	const manifest = `${window.location.origin}/api/${config.apiPrefix}/${dmmCastToken}`;
	const stremioManifest = manifest.replace(/^https?:\/\//, 'stremio://');
	// Real-Debrid's hook used to hand out a 'default' placeholder before the
	// token resolved; it must never become an install link.
	const ready = dmmCastToken !== 'default';

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
			<Head>
				<title>{title}</title>
			</Head>

			<Image width={72} height={72} src={config.logo} alt="logo" className="mb-2" />
			<h1 className={`mb-1 text-center text-2xl font-bold ${theme.heading}`}>
				DMM Cast for {name}
			</h1>
			<div className="flex flex-col items-center text-white">
				<strong>Cast from any device to Stremio</strong>

				{ready && (
					<div className="mt-3 mb-3 h-max w-full max-w-md text-center leading-8">
						<Link
							href={`${stremioManifest}/manifest.json`}
							className={`text-md haptic-sm m-1 rounded border-2 px-4 py-2 font-medium text-gray-100 transition-colors ${theme.button}`}
						>
							<Wand2 className={`mr-1 inline-block h-4 w-4 ${theme.icon}`} />
							Install
						</Link>
						<Link
							href={`https://web.stremio.com/#/addons?addon=${encodeURIComponent(
								`${manifest}/manifest.json`
							)}`}
							className={`text-md haptic-sm m-1 rounded border-2 px-4 py-2 font-medium text-gray-100 transition-colors ${theme.button}`}
							target="_blank"
							rel="noopener noreferrer"
						>
							<Globe className="mr-1 inline-block h-4 w-4 text-blue-400" />
							Install (web)
						</Link>
						<div className={`mt-2 text-sm leading-5 ${theme.alert}`}>
							<AlertTriangle className={`mr-1 inline-block h-4 w-4 ${theme.alert}`} />
							Private to your account: never share it. Paste it in Stremio&apos;s
							search bar to install.
						</div>
						<code className="mt-2 block w-full rounded bg-gray-800 p-2 text-sm break-all text-gray-300">
							{manifest}/manifest.json
						</code>

						{/* No Catalog Version */}
						<div className="mt-2 flex flex-wrap items-center justify-center border-t border-gray-700 pt-2">
							<span
								className="mr-1 inline-flex items-center text-xs text-gray-400 sm:text-sm"
								title="Hides all catalogs from Stremio home"
							>
								<EyeOff className="mr-1 h-3 w-3" />
								Without catalogs:
							</span>
							<Link
								href={`${stremioManifest}/no-catalog/manifest.json`}
								className="haptic-sm m-0.5 rounded border border-gray-600 bg-gray-800/50 px-2 py-1 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700/50"
							>
								<Wand2 className="mr-1 inline-block h-3 w-3 text-gray-400" />
								Install
							</Link>
							<Link
								href={`https://web.stremio.com/#/addons?addon=${encodeURIComponent(
									`${manifest}/no-catalog/manifest.json`
								)}`}
								className="haptic-sm m-0.5 rounded border border-gray-600 bg-gray-800/50 px-2 py-1 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700/50"
								target="_blank"
								rel="noopener noreferrer"
							>
								<Globe className="mr-1 inline-block h-3 w-3 text-gray-400" />
								Install (web)
							</Link>
						</div>
					</div>
				)}

				<p className="max-w-md text-center text-sm text-gray-300">
					Open a movie or show in DMM and press{' '}
					<Cast className={`inline-block h-3 w-3 ${theme.icon}`} /> Cast: Stremio opens on
					it with your stream listed.
				</p>

				<CastSettingsPanel service={config.service} accentColor={config.accentColor} />
				{config.notice}
			</div>

			<div className="mt-6 flex gap-4">
				{ready && (
					<Link
						href={`${config.castPath}/manage`}
						className={`haptic-sm rounded border-2 px-4 py-2 text-sm font-medium transition-colors ${theme.button} ${theme.buttonText}`}
					>
						<span className="inline-flex items-center">
							<ClipboardList className="mr-1 h-4 w-4" />
							Manage Casted Links
						</span>
					</Link>
				)}
				<Link
					href="/"
					className="haptic-sm rounded border-2 border-cyan-500 bg-cyan-900/30 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>
		</div>
	);
}
