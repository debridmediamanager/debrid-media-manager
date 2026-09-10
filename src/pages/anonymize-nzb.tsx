import { Card } from '@/components/IndexerSetup';
import { Logo } from '@/components/Logo';
import { saveBlob } from '@/utils/nzbDownload';
import { safeNzbName } from '@/utils/nzbName';
import { sanitizeNzb, type SanitizedNzb } from '@/utils/nzbSanitize';
import { FileDown, ShieldCheck, TriangleAlert, Upload, X } from 'lucide-react';
import Head from 'next/head';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

// Rebuilds an NZB someone already has so it can be posted publicly without
// naming the account that grabbed it.
//
// Unlisted on purpose: nothing links here. It needs no login and no server,
// because the cleaning is the same `sanitizeNzb` the Usenet panel's Download
// button runs, and that module is plain string work — so the file is read,
// rebuilt and saved inside the browser, and never leaves it. That matters more
// here than anywhere else in DMM: an NZB still carrying its indexer's
// per-download tag is exactly what this page exists to keep off a server.

interface LoadedNzb {
	id: number;
	/** The name the file had on disk, which is also what it is saved back as. */
	name: string;
	source: string;
}

type Outcome = { ok: true; result: SanitizedNzb } | { ok: false; error: string };

function clean(source: string, keepPassword: boolean): Outcome {
	try {
		return { ok: true, result: sanitizeNzb(source, { keepPassword }) };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'That file could not be read as an NZB',
		};
	}
}

function plural(count: number, noun: string): string {
	return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

function save(name: string, result: SanitizedNzb): void {
	saveBlob(new Blob([result.xml], { type: 'application/x-nzb' }), safeNzbName(name));
}

/**
 * Pause between the saves of one "Download all".
 *
 * Chrome keeps only the first ten downloads a page fires back to back and drops
 * the rest without an error. Measured 2026-09-10 on this page: 10 of 25 landed
 * with no gap, 24 of 25 at 100 ms, all 25 from 250 ms apart. This is twice the
 * smallest gap that kept them all, because the limit is Chrome's and can move.
 */
const DOWNLOAD_GAP_MS = 500;

function Warnings({ result }: { result: SanitizedNzb }) {
	const lines: string[] = [];
	if (result.plantedSuspects.length > 0) {
		lines.push(
			`${plural(result.plantedSuspects.length, 'tiny file')} left in, under 4 KB each. Small par2, nfo and sfv files are normal, but a planted "downloaded by" article looks the same, so check the names before sharing: ${result.plantedSuspects.join(', ')}`
		);
	}
	if (result.suspectBytes > 0) {
		lines.push(
			`${plural(result.suspectBytes, 'segment')} with a size SABnzbd refuses. The source was already like that, and the sizes were left alone rather than guessed.`
		);
	}
	if (result.droppedFiles > 0 || result.droppedSegments > 0) {
		lines.push(
			`Left out ${plural(result.droppedFiles, 'empty file')} and ${plural(result.droppedSegments, 'segment')} with no article id. Neither could be downloaded anyway.`
		);
	}
	if (lines.length === 0) return null;

	return (
		<ul className="mt-3 flex flex-col gap-2">
			{lines.map((line) => (
				<li
					key={line}
					className="flex gap-2 rounded border-2 border-yellow-500/30 p-2 text-xs text-gray-300"
				>
					<TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
					<span className="min-w-0 break-words">{line}</span>
				</li>
			))}
		</ul>
	);
}

function NzbResult({
	name,
	outcome,
	onRemove,
}: {
	name: string;
	outcome: Outcome;
	onRemove: () => void;
}) {
	return (
		<li
			data-testid="nzb-result"
			className="rounded border-2 border-gray-600/50 bg-gray-900/40 p-3"
		>
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="truncate font-mono text-sm text-gray-100">{name}</div>
					{outcome.ok ? (
						<div className="text-xs text-gray-400">
							{plural(outcome.result.files, 'file')},{' '}
							{plural(outcome.result.segments, 'segment')}
						</div>
					) : null}
				</div>
				{outcome.ok ? (
					<button
						type="button"
						onClick={() => save(name, outcome.result)}
						className="inline-flex shrink-0 items-center gap-1.5 rounded border-2 border-green-500 bg-green-900/30 px-2.5 py-1 text-xs text-green-100 transition-colors hover:bg-green-800/50"
					>
						<FileDown className="h-4 w-4" />
						Download
					</button>
				) : null}
				<button
					type="button"
					aria-label={`Remove ${name}`}
					onClick={onRemove}
					className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			{outcome.ok ? (
				<>
					{outcome.result.removed.length > 0 ? (
						<div className="mt-3">
							<div className="text-xs font-semibold text-gray-300">Taken off</div>
							<ul className="mt-1 list-inside list-disc text-xs text-gray-400">
								{outcome.result.removed.map((entry) => (
									<li key={entry} className="break-words">
										{entry}
									</li>
								))}
							</ul>
						</div>
					) : (
						<p className="mt-3 text-xs text-gray-400">
							Nothing identifying was on it. It was rebuilt anyway, so the copy you
							share has the same layout as every other one cleaned here.
						</p>
					)}
					<Warnings result={outcome.result} />
				</>
			) : (
				<p className="mt-2 text-xs text-red-300">{outcome.error}</p>
			)}
		</li>
	);
}

export default function AnonymizeNzbPage() {
	const [loaded, setLoaded] = useState<LoadedNzb[]>([]);
	const [keepPassword, setKeepPassword] = useState(true);
	const [dragging, setDragging] = useState(false);
	// A ref, not state: two drops in quick succession each read it before either
	// render lands, and state read from a closure would hand both the same ids.
	const nextId = useRef(1);
	// How far a Download all has got, for the button, and its saves still to come,
	// so leaving the page cancels them instead of downloading from a closed tab.
	const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
	const pendingSaves = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(() => {
		const pending = pendingSaves.current;
		return () => pending.forEach(clearTimeout);
	}, []);

	// Recomputed from the source rather than stored, so flipping the password
	// switch re-cleans what is already on the page instead of only what comes next.
	const results = useMemo(
		() => loaded.map((nzb) => ({ ...nzb, outcome: clean(nzb.source, keepPassword) })),
		[loaded, keepPassword]
	);
	const downloadable = results.filter(
		(entry): entry is typeof entry & { outcome: { ok: true; result: SanitizedNzb } } =>
			entry.outcome.ok
	);

	const downloadAll = () => {
		const queue = downloadable.map((entry) => ({
			name: entry.name,
			result: entry.outcome.result,
		}));
		queue.forEach(({ name, result }, index) => {
			const step = () => {
				save(name, result);
				const last = index + 1 === queue.length;
				if (last) pendingSaves.current.length = 0;
				setSaving(last ? null : { done: index + 1, total: queue.length });
			};
			// The first goes out inside the click, exactly like a single Download.
			if (index === 0) step();
			else pendingSaves.current.push(setTimeout(step, index * DOWNLOAD_GAP_MS));
		});
	};

	const addFiles = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const read = await Promise.all(
			Array.from(files).map(async (file) => ({ name: file.name, source: await file.text() }))
		);
		const withIds = read.map((nzb) => ({ ...nzb, id: nextId.current++ }));
		setLoaded((current) => [...current, ...withIds]);
	};

	const onDrop = (event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault();
		setDragging(false);
		void addFiles(event.dataTransfer.files);
	};

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Anonymize an NZB</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Logo />

			<div className="mt-6 flex w-full max-w-3xl flex-col gap-5 pb-16">
				<header>
					<h1 className="text-2xl font-bold text-gray-100">Anonymize an NZB</h1>
					<p className="mt-2 text-sm text-gray-400">
						Indexers stamp the NZBs they hand out with a tag that traces back to your
						account. Drop one here to get a copy you can share publicly: the same
						download, with nothing on it that says who grabbed it.
					</p>
				</header>

				<div
					data-testid="client-side-notice"
					className="flex gap-3 rounded border-2 border-green-500/40 bg-green-900/10 p-3"
				>
					<ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
					<div className="text-sm">
						<div className="font-semibold text-green-200">Client-side only</div>
						<p className="mt-1 text-gray-300">
							Your NZB is read, cleaned and saved inside this browser. Nothing is
							uploaded, not even to DMM, so the tag being removed never reaches any
							server. Once this page has loaded it works with the network switched
							off.
						</p>
					</div>
				</div>

				<Card title="Your NZBs">
					<label
						data-testid="nzb-dropzone"
						onDragOver={(event) => {
							event.preventDefault();
							setDragging(true);
						}}
						onDragLeave={() => setDragging(false)}
						onDrop={onDrop}
						className={`flex cursor-pointer flex-col items-center gap-2 rounded border-2 border-dashed px-4 py-8 text-center transition-colors ${
							dragging
								? 'border-cyan-400 bg-cyan-900/20'
								: 'border-gray-600 hover:border-gray-400'
						}`}
					>
						<Upload className="h-6 w-6 text-gray-400" />
						<span className="text-sm text-gray-200">
							Drop .nzb files here, or click to choose
						</span>
						<input
							type="file"
							accept=".nzb,application/x-nzb"
							multiple
							aria-label="Choose NZB files"
							className="sr-only"
							onChange={(event) => {
								void addFiles(event.target.files);
								// Choosing the same file again should add it again.
								event.target.value = '';
							}}
						/>
					</label>

					<label className="mt-3 flex items-start gap-2 text-xs text-gray-300">
						<input
							type="checkbox"
							checked={keepPassword}
							onChange={(event) => setKeepPassword(event.target.checked)}
							className="mt-0.5"
						/>
						<span>
							Keep the archive password. It belongs to the release, not to you, and
							without it a passworded release will not extract for anyone you share it
							with.
						</span>
					</label>

					{results.length > 0 ? (
						<ul className="mt-4 flex flex-col gap-3">
							{results.map((entry) => (
								<NzbResult
									key={entry.id}
									name={entry.name}
									outcome={entry.outcome}
									onRemove={() =>
										setLoaded((current) =>
											current.filter((nzb) => nzb.id !== entry.id)
										)
									}
								/>
							))}
						</ul>
					) : null}

					{downloadable.length > 1 ? (
						<button
							type="button"
							disabled={saving !== null}
							onClick={downloadAll}
							className="mt-3 inline-flex items-center gap-1.5 rounded border-2 border-green-500 bg-green-900/30 px-3 py-1.5 text-sm text-green-100 transition-colors hover:bg-green-800/50 disabled:cursor-wait disabled:opacity-60"
						>
							<FileDown className="h-4 w-4" />
							{saving
								? `Saving ${saving.done} of ${saving.total}`
								: `Download all ${downloadable.length}`}
						</button>
					) : null}
				</Card>

				<Card title="What changes">
					<p className="text-gray-300">
						The NZB is rebuilt from its articles rather than edited, so anything an
						indexer adds, including fields nobody has seen yet, is left behind by
						default.
					</p>
					<ul className="mt-3 list-inside list-disc text-gray-400">
						<li>
							<strong className="text-gray-200">Removed:</strong> every head field but
							the release name, category and archive password, the per-download tokens
							some indexers hide in those three, account stamps in file subjects, XML
							comments, the DOCTYPE, and the poster, date and newsgroups on each file.
						</li>
						<li>
							<strong className="text-gray-200">Kept:</strong> the release name,
							category and a real archive password, and each file&apos;s subject and
							article ids. Those are identical in every copy of the release, so they
							identify the release and never you. Every file gets the same fixed
							newsgroup, since downloaders fetch articles by id anyway.
						</li>
					</ul>
				</Card>
			</div>
		</div>
	);
}
