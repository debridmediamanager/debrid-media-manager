import { Card } from '@/components/IndexerSetup';
import { Logo } from '@/components/Logo';
import { ArrowLeft } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

// The public half of notice-and-takedown. What is filed here waits for review.
// Approving it in /copyright/admin is what removes the content.

const inputClass =
	'w-full rounded border border-gray-600 bg-gray-900/60 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:outline-none';

type Receipt = { id: string; hashes: number; releases: number; hashlists: number };

function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<label className="flex flex-col gap-1">
			<span className="text-sm font-medium text-gray-200">{label}</span>
			{children}
			{hint ? <span className="text-xs text-gray-400">{hint}</span> : null}
		</label>
	);
}

export default function CopyrightPage() {
	const [form, setForm] = useState({
		claimantName: '',
		claimantEmail: '',
		representing: '',
		work: '',
		locations: '',
		releaseNames: '',
		reason: '',
		goodFaith: false,
		accurate: false,
	});
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [receipt, setReceipt] = useState<Receipt | null>(null);

	const set =
		(key: keyof typeof form) =>
		(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			const { type, value, checked } = event.target as HTMLInputElement;
			setForm((current) => ({ ...current, [key]: type === 'checkbox' ? checked : value }));
		};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch('/api/takedown', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form),
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				setError(body.error ?? 'The notice could not be sent. Please try again.');
				return;
			}
			setReceipt(body as Receipt);
		} catch {
			setError('The notice could not be sent. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Copyright notice</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Logo />

			<div className="mt-6 flex w-full max-w-3xl flex-col gap-5 pb-16">
				<Link
					href="/"
					className="inline-flex w-full items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to dashboard</span>
				</Link>
				<header>
					<h1 className="text-2xl font-bold text-gray-100">
						Report copyright infringement
					</h1>
					<p className="mt-2 text-sm text-gray-400">
						Debrid Media Manager stores no files. It lists torrent hashes and Usenet
						release names. If one of them points to your work without your permission
						you can ask us to remove it here. We review every notice. Approved content
						is removed from search results and share pages. Our upload services refuse
						it as well.
					</p>
				</header>

				{receipt ? (
					<Card title="Notice received">
						<p>
							Your reference is{' '}
							<code className="font-mono text-cyan-300">{receipt.id}</code>. Keep it
							for your records.
						</p>
						<p className="mt-2 text-gray-400">
							We read {receipt.hashes} hashes and {receipt.releases} release names and{' '}
							{receipt.hashlists} share pages from your notice. We will review it and
							reply to the email address you gave.
						</p>
					</Card>
				) : (
					<form onSubmit={submit} className="flex flex-col gap-5">
						<Card title="About you">
							<div className="flex flex-col gap-4">
								<Field label="Full name">
									<input
										className={inputClass}
										value={form.claimantName}
										onChange={set('claimantName')}
										maxLength={200}
										required
									/>
								</Field>
								<Field label="Email address">
									<input
										type="email"
										className={inputClass}
										value={form.claimantEmail}
										onChange={set('claimantEmail')}
										maxLength={320}
										required
									/>
								</Field>
								<Field
									label="Rights holder you act for"
									hint="Leave this empty if you own the rights yourself."
								>
									<input
										className={inputClass}
										value={form.representing}
										onChange={set('representing')}
										maxLength={200}
									/>
								</Field>
							</div>
						</Card>

						<Card title="What to remove">
							<div className="flex flex-col gap-4">
								<Field
									label="The copyrighted work"
									hint="The title and anything that identifies it such as year or edition."
								>
									<textarea
										className={inputClass}
										rows={3}
										value={form.work}
										onChange={set('work')}
										maxLength={10000}
										required
									/>
								</Field>
								<Field
									label="Torrent hashes and links"
									hint="Paste infohashes or magnet links or Debrid Media Manager share page URLs. One per line or in any layout. We read every one we find."
								>
									<textarea
										className={`${inputClass} font-mono`}
										rows={6}
										value={form.locations}
										onChange={set('locations')}
									/>
								</Field>
								<Field
									label="Usenet release names"
									hint="One release name per line. Optional."
								>
									<textarea
										className={`${inputClass} font-mono`}
										rows={4}
										value={form.releaseNames}
										onChange={set('releaseNames')}
									/>
								</Field>
								<Field label="Why this infringes your rights">
									<textarea
										className={inputClass}
										rows={3}
										value={form.reason}
										onChange={set('reason')}
										maxLength={10000}
										required
									/>
								</Field>
							</div>
						</Card>

						<Card title="Statements">
							<div className="flex flex-col gap-3">
								<label className="flex items-start gap-2">
									<input
										type="checkbox"
										className="mt-1"
										checked={form.goodFaith}
										onChange={set('goodFaith')}
									/>
									<span>
										I believe in good faith that this use is not authorised by
										the rights holder or its agent or the law.
									</span>
								</label>
								<label className="flex items-start gap-2">
									<input
										type="checkbox"
										className="mt-1"
										checked={form.accurate}
										onChange={set('accurate')}
									/>
									<span>
										The information in this notice is accurate. I own the rights
										or I am authorised to act for the owner.
									</span>
								</label>
							</div>
						</Card>

						{error ? (
							<p className="rounded border border-red-500/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">
								{error}
							</p>
						) : null}

						<button
							type="submit"
							disabled={submitting || !form.goodFaith || !form.accurate}
							className="self-start rounded bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{submitting ? 'Sending…' : 'Send notice'}
						</button>
					</form>
				)}
			</div>
		</div>
	);
}
