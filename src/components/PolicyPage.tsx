import { Logo } from '@/components/Logo';
import { ArrowLeft } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** A plain public page of headed sections: the privacy policy and support page the app stores link to. */
export function PolicyPage({
	title,
	intro,
	children,
}: {
	title: string;
	intro: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>{`Debrid Media Manager - ${title}`}</title>
			</Head>
			<Logo />
			<main className="mt-6 flex w-full max-w-3xl flex-col gap-6 pb-16 text-sm leading-relaxed text-gray-200 [&_a]:text-cyan-400 [&_a]:underline [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-100 [&_li]:ml-5 [&_li]:list-disc [&_p+p]:mt-2 [&_ul]:mt-2 [&_ul]:space-y-1">
				<Link
					href="/"
					className="inline-flex items-center gap-2 text-sm text-gray-400 no-underline transition-colors hover:text-gray-200"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to dashboard</span>
				</Link>
				<header>
					<h1 className="text-2xl font-bold text-gray-100">{title}</h1>
					<div className="mt-2 text-gray-400">{intro}</div>
				</header>
				{children}
			</main>
		</div>
	);
}
