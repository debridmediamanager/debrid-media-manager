import { Check, Link2, RefreshCw, Save, Share2, Sparkles, Trash2, Wrench, X } from 'lucide-react';
import LibraryButton from './LibraryButton';

interface LibraryActionButtonsProps {
	onSelectShown: () => void;
	onResetSelection: () => void;
	onReinsertTorrents: () => void;
	onGenerateHashlist: () => void;
	onDeleteShownTorrents: () => void;
	onAddMagnet: (service: string) => void;
	onLocalRestore: (service: 'rd' | 'ad' | 'tb') => Promise<void>;
	onLocalBackup: () => Promise<void>;
	onDedupeBySize: () => void;
	onDedupeByRecency: () => void;
	onCombineSameHash: () => void;
	selectedTorrentsSize: number;
	rdKey: string | null;
	adKey: string | null;
	tbKey?: string | null;
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
	tbKey,
	showDedupe,
	showHashCombine,
}: LibraryActionButtonsProps) {
	return (
		<div className="relative mb-0 flex overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
			<LibraryButton variant="orange" onClick={onSelectShown}>
				<Check className="mr-1 inline-block h-4 w-4 text-green-500" />
				Select Shown
			</LibraryButton>

			<LibraryButton variant="orange" onClick={onResetSelection}>
				<X className="mr-1 inline-block h-4 w-4 text-red-500" />
				Unselect All
			</LibraryButton>

			<LibraryButton variant="green" onClick={onReinsertTorrents}>
				<RefreshCw className="mr-1 inline-block h-4 w-4 text-cyan-500" />
				Reinsert{selectedTorrentsSize ? ` (${selectedTorrentsSize})` : ' List'}
			</LibraryButton>

			<LibraryButton variant="indigo" onClick={onGenerateHashlist}>
				<Share2 className="mr-1 inline-block h-4 w-4 text-purple-500" />
				Share{selectedTorrentsSize ? ` (${selectedTorrentsSize})` : ' List'}
			</LibraryButton>

			<LibraryButton variant="red" onClick={onDeleteShownTorrents}>
				<Trash2 className="mr-1 inline-block h-4 w-4 text-red-500" />
				Delete{selectedTorrentsSize ? ` (${selectedTorrentsSize})` : ' List'}
			</LibraryButton>

			{rdKey && (
				<>
					<LibraryButton variant="teal" onClick={() => onAddMagnet('rd')}>
						<Link2 className="mr-1 inline-block h-4 w-4 text-teal-500" />
						RD&nbsp;Add
					</LibraryButton>
					<LibraryButton variant="indigo" onClick={() => onLocalRestore('rd')}>
						<Wrench className="mr-1 inline-block h-4 w-4 text-indigo-500" />
						RD Restore
					</LibraryButton>
				</>
			)}

			{adKey && (
				<>
					<LibraryButton variant="teal" onClick={() => onAddMagnet('ad')}>
						<Link2 className="mr-1 inline-block h-4 w-4 text-teal-500" />
						AD&nbsp;Add
					</LibraryButton>
					<LibraryButton variant="indigo" onClick={() => onLocalRestore('ad')}>
						<Wrench className="mr-1 inline-block h-4 w-4 text-indigo-500" />
						AD Restore
					</LibraryButton>
				</>
			)}

			{tbKey && (
				<>
					<LibraryButton variant="teal" onClick={() => onAddMagnet('tb')}>
						<Link2 className="mr-1 inline-block h-4 w-4 text-teal-500" />
						TB&nbsp;Add
					</LibraryButton>
					<LibraryButton variant="indigo" onClick={() => onLocalRestore('tb')}>
						<Wrench className="mr-1 inline-block h-4 w-4 text-indigo-500" />
						TB Restore
					</LibraryButton>
				</>
			)}

			<LibraryButton variant="indigo" onClick={onLocalBackup}>
				<Save className="mr-1 inline-block h-4 w-4 text-blue-500" />
				Backup
			</LibraryButton>

			{showDedupe && (
				<>
					<LibraryButton variant="green" onClick={onDedupeBySize}>
						Size <Sparkles className="ml-1 inline-block h-4 w-4 text-green-500" />
					</LibraryButton>
					<LibraryButton variant="green" onClick={onDedupeByRecency}>
						Date <Sparkles className="ml-1 inline-block h-4 w-4 text-green-500" />
					</LibraryButton>
				</>
			)}

			{showHashCombine && (
				<LibraryButton variant="green" onClick={onCombineSameHash}>
					Hash <Sparkles className="ml-1 inline-block h-4 w-4 text-green-500" />
				</LibraryButton>
			)}
		</div>
	);
}
