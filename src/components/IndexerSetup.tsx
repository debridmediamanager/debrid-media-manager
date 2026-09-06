import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

// The furniture shared by the two indexer setup pages, `/newznab` and
// `/torznab`. They render the same three-column rows of an *arr's Add Indexer
// form, and one of those rows carries a credential — which is reason enough for
// there to be exactly one copy of it rather than one per page.

export function CopyButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	return (
		<button
			type="button"
			aria-label={`Copy ${label}`}
			className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
				} catch {
					toast.error('Could not reach the clipboard — copy it by hand');
				}
			}}
		>
			{copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
		</button>
	);
}

/** One row of *arr's Add Indexer form. */
export function Field({
	label,
	value,
	hint,
	copyable = true,
	copyValue,
	extra,
}: {
	label: string;
	value: string;
	hint?: string;
	copyable?: boolean;
	/** What the copy button puts on the clipboard, when it differs from what is shown. */
	copyValue?: string;
	/** An extra control between the value and the copy button. */
	extra?: ReactNode;
}) {
	return (
		<div
			data-testid={`field-${label}`}
			className="flex flex-col gap-1 border-b border-gray-700/60 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
		>
			<div className="w-32 shrink-0 text-sm font-semibold text-gray-300">{label}</div>
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<code className="min-w-0 flex-1 truncate rounded bg-gray-800 px-2 py-1.5 font-mono text-sm text-cyan-300">
					{value}
				</code>
				{extra}
				{copyable ? <CopyButton value={copyValue ?? value} label={label} /> : null}
			</div>
			{hint ? <div className="text-xs text-gray-500 sm:w-56 sm:shrink-0">{hint}</div> : null}
		</div>
	);
}

/** Enough of a key to recognise which one it is, never enough to use it. */
export function maskApiKey(apiKey: string): string {
	if (apiKey.length <= 12) return '•'.repeat(apiKey.length);
	return `${apiKey.slice(0, 6)}${'•'.repeat(8)}${apiKey.slice(-4)}`;
}

/**
 * The API key row.
 *
 * Filled from `dmm:apiKey`, which the browser keeps once a sponsorship has been
 * linked in Settings. The whole point of these pages is pasting that key into an
 * \*arr, and sending someone back to gatekeeper to look it up again for every
 * indexer they add was the one step of the setup DMM could remove.
 *
 * Masked until asked for. A setup page is exactly what someone screen-shares or
 * screenshots while wiring up their stack, and the copy button hands over the
 * whole key without ever putting it on screen — so revealing it is a choice
 * rather than the price of using the page.
 */
export function ApiKeyField({ apiKey }: { apiKey: string | null }) {
	const [revealed, setRevealed] = useState(false);

	// A browser that linked its sponsorship before this page could store the key,
	// or one that never linked at all. Settings is where that is fixed.
	if (!apiKey) {
		return (
			<Field
				label="API Key"
				value="your DMM API key from gatekeeper"
				copyable={false}
				hint="paste it in Settings to show it here"
			/>
		);
	}

	return (
		<Field
			label="API Key"
			value={revealed ? apiKey : maskApiKey(apiKey)}
			copyValue={apiKey}
			hint="the key linked to this browser"
			extra={
				<button
					type="button"
					aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
					className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
					onClick={() => setRevealed((current) => !current)}
				>
					{revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
				</button>
			}
		/>
	);
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="w-full rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-5 shadow">
			<h2 className="mb-3 text-lg font-semibold text-gray-100">{title}</h2>
			<div className="text-sm text-gray-200">{children}</div>
		</section>
	);
}
