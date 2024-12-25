interface LibraryActionButtonsProps {
	onSelectShown: () => void;
	onResetSelection: () => void;
	onReinsertTorrents: () => void;
	onGenerateHashlist: () => void;
	onDeleteShownTorrents: () => void;
	onAddMagnet: (service: string) => void;
	onLocalRestore: (service: 'rd' | 'ad') => Promise<void>;
	onLocalBackup: () => Promise<void>;
	onDedupeBySize: () => void;
	onDedupeByRecency: () => void;
	onCombineSameHash: () => void;
	selectedTorrentsSize: number;
	rdKey: string | null;
	adKey: string | null;
	showDedupe: boolean;
	showHashCombine: boolean;
}

export default function LibraryActionButtons({
	onSelectShown,
	onResetSelection,
	onReinsertTorrents,
	onGenerateHashlist,
	onDeleteShownTorrents,
	onAddMagnet,
	onLocalRestore,
	onLocalBackup,
	onDedupeBySize,
	onDedupeByRecency,
	onCombineSameHash,
	selectedTorrentsSize,
	rdKey,
	adKey,
	showDedupe,
	showHashCombine,
}: LibraryActionButtonsProps) {
	return (
		<div className="mb-0 flex overflow-x-auto">
			<button
				className="mb-1 mr-2 rounded border-2 border-orange-500 bg-orange-900/30 px-1 py-0.5 text-[0.6rem] text-orange-100 transition-colors hover:bg-orange-800/50"
				onClick={onSelectShown}
			>
				✅ Select Shown
			</button>

			<button
				className="mb-1 mr-2 rounded border-2 border-orange-500 bg-orange-900/30 px-1 py-0.5 text-[0.6rem] text-orange-100 transition-colors hover:bg-orange-800/50"
				onClick={onResetSelection}
			>
				❌ Unselect All
			</button>
			<button
				className={`mb-1 mr-2 rounded border-2 border-green-500 bg-green-900/30 px-1 py-0.5 text-[0.6rem] text-green-100 transition-colors hover:bg-green-800/50`}
				onClick={onReinsertTorrents}
			>
				🔄 Reinsert{selectedTorrentsSize ? ` (${selectedTorrentsSize})` : ' List'}
			</button>
			<button
				className={`mb-1 mr-2 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-0.5 text-[0.6rem] text-indigo-100 transition-colors hover:bg-indigo-800/50`}
				onClick={onGenerateHashlist}
			>
				🚀 Share{selectedTorrentsSize ? ` (${selectedTorrentsSize})` : ' List'}
			</button>
			<button
				className={`mb-1 mr-2 rounded border-2 border-red-500 bg-red-900/30 px-1 py-0.5 text-[0.6rem] text-red-100 transition-colors hover:bg-red-800/50`}
				onClick={onDeleteShownTorrents}
			>
				🗑️ Delete{selectedTorrentsSize ? ` (${selectedTorrentsSize})` : ' List'}
			</button>

			{rdKey && (
				<>
					<button
						className={`mb-1 mr-2 rounded border-2 border-teal-500 bg-teal-900/30 px-1 py-0.5 text-[0.6rem] text-teal-100 transition-colors hover:bg-teal-800/50`}
						onClick={() => onAddMagnet('rd')}
					>
						🧲 RD&nbsp;Add
					</button>
					<button
						className={`mb-1 mr-2 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-0.5 text-[0.6rem] text-indigo-100 transition-colors hover:bg-indigo-800/50`}
						onClick={() => onLocalRestore('rd')}
					>
						🪛 RD Restore
					</button>
				</>
			)}
			{adKey && (
				<>
					<button
						className={`mb-1 mr-2 rounded border-2 border-teal-500 bg-teal-900/30 px-1 py-0.5 text-[0.6rem] text-teal-100 transition-colors hover:bg-teal-800/50`}
						onClick={() => onAddMagnet('ad')}
					>
						🧲 AD&nbsp;Add
					</button>
					<button
						className={`mb-1 mr-2 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-0.5 text-[0.6rem] text-indigo-100 transition-colors hover:bg-indigo-800/50`}
						onClick={() => onLocalRestore('ad')}
					>
						🪛 AD Restore
					</button>
				</>
			)}

			<button
				className={`mb-1 mr-2 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-0.5 text-[0.6rem] text-indigo-100 transition-colors hover:bg-indigo-800/50`}
				onClick={onLocalBackup}
			>
				💾 Backup
			</button>

			{showDedupe && (
				<>
					<button
						className="mb-1 mr-2 rounded border-2 border-green-500 bg-green-900/30 px-1 py-0.5 text-[0.6rem] text-green-100 transition-colors hover:bg-green-800/50"
						onClick={onDedupeBySize}
					>
						Size 🧹
					</button>

					<button
						className="mb-1 mr-2 rounded border-2 border-green-500 bg-green-900/30 px-1 py-0.5 text-[0.6rem] text-green-100 transition-colors hover:bg-green-800/50"
						onClick={onDedupeByRecency}
					>
						Date 🧹
					</button>
				</>
			)}

			{showHashCombine && (
				<button
					className={`mb-1 mr-2 rounded border-2 border-green-500 bg-green-900/30 px-1 py-0.5 text-[0.6rem] text-green-100 transition-colors hover:bg-green-800/50`}
					onClick={onCombineSameHash}
				>
					Hash 🧹
				</button>
			)}
		</div>
	);
}
