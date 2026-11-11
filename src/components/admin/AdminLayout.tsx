import { Logo } from '@/components/Logo';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useCallback, useEffect, useState } from 'react';

// The shell every /admin page sits in: navigation, and one token (ADMIN_TOKEN) for
// all of them. Each admin API checks it on every call; this page holds no secret.

export const ADMIN_PAGES = [
	{ href: '/admin/reports', label: 'Reported releases' },
	{ href: '/admin/newznab', label: 'Newznab indexers' },
	{ href: '/admin/settings', label: 'Site settings' },
	{ href: '/admin/copyright', label: 'Copyright notices' },
];

const TOKEN_KEY = 'dmm:adminToken';
// Where the pages kept their own tokens before /admin, read once so a browser stays signed in.
const OLD_TOKEN_KEYS = ['dmm:takedownAdminToken', 'dmm:newznabAdminToken'];

const readToken = () => {
	try {
		return (
			localStorage.getItem(TOKEN_KEY) ??
			OLD_TOKEN_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) ??
			''
		);
	} catch {
		return '';
	}
};

const saveToken = (token: string) => {
	try {
		localStorage.setItem(TOKEN_KEY, token);
	} catch {
		// A private window keeps the token for this visit only.
	}
};

/** `fetch` with the admin token; a 401 reopens the token form. */
export type AdminFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function AdminLayout({
	title,
	children,
}: {
	title: string;
	/**
	 * A function is a page behind the token: it renders once one is set, and `adminFetch`
	 * changes with the token, so effects that use it re-run. Plain content needs no token.
	 */
	children: ReactNode | ((adminFetch: AdminFetch) => ReactNode);
}) {
	const { pathname } = useRouter();
	const [token, setToken] = useState('');
	const [refused, setRefused] = useState(false);
	// The token form folds to a link once a request has succeeded with it.
	const [accepted, setAccepted] = useState(false);
	const [changingToken, setChangingToken] = useState(false);

	useEffect(() => setToken(readToken()), []);

	const adminFetch = useCallback<AdminFetch>(
		async (url, init = {}) => {
			const res = await fetch(url, {
				...init,
				headers: { ...init.headers, Authorization: `Bearer ${token}` },
			});
			setRefused(res.status === 401);
			if (res.ok) setAccepted(true);
			return res;
		},
		[token]
	);

	const gated = typeof children === 'function';
	const showForm = gated && (!token || refused || !accepted || changingToken);

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>{`Debrid Media Manager - Admin - ${title}`}</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Logo />
			<div className="mt-6 flex w-full max-w-4xl flex-col gap-4 pb-16">
				<nav className="flex flex-wrap gap-2 border-b border-gray-700 pb-3 text-sm">
					<Link
						href="/admin"
						className="mr-2 self-center font-semibold text-gray-400 hover:text-gray-200"
					>
						Admin
					</Link>
					{ADMIN_PAGES.map((page) => (
						<Link
							key={page.href}
							href={page.href}
							className={`rounded px-3 py-1 ${
								pathname === page.href
									? 'bg-gray-200 text-gray-900'
									: 'border border-gray-600 text-gray-300 hover:bg-gray-800'
							}`}
						>
							{page.label}
						</Link>
					))}
				</nav>
				<h1 className="text-2xl font-bold text-gray-100">{title}</h1>
				{showForm ? (
					<form
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							const value =
								new FormData(event.currentTarget).get('token')?.toString() ?? '';
							saveToken(value);
							setRefused(false);
							setAccepted(false);
							setChangingToken(false);
							setToken(value);
						}}
					>
						<input
							name="token"
							type="password"
							defaultValue={token}
							key={token}
							placeholder="Admin token"
							className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900/60 px-3 py-2 text-sm text-gray-100"
						/>
						<button className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-600">
							Use token
						</button>
					</form>
				) : gated ? (
					<button
						onClick={() => setChangingToken(true)}
						className="self-start text-sm text-cyan-300 underline hover:text-cyan-200"
					>
						Change token
					</button>
				) : null}
				{refused ? <p className="text-sm text-yellow-300">The token was refused.</p> : null}
				{gated ? (token ? children(adminFetch) : null) : children}
			</div>
		</div>
	);
}
