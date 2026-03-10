import { X } from 'lucide-react';

const SHORTCUTS = [
	{ key: 'Space', description: 'Play / Pause' },
	{ key: '\u2190', description: 'Previous track' },
	{ key: '\u2192', description: 'Next track' },
	{ key: '\u2191', description: 'Volume up' },
	{ key: '\u2193', description: 'Volume down' },
	{ key: 'M', description: 'Mute / Unmute' },
	{ key: 'S', description: 'Toggle shuffle' },
	{ key: 'R', description: 'Toggle repeat' },
	{ key: 'Q', description: 'Toggle queue' },
	{ key: '?', description: 'Show shortcuts' },
	{ key: 'F1', description: 'Show shortcuts' },
];

interface KeyboardShortcutsModalProps {
	onClose: () => void;
}

export default function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
	return (
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="relative mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					onClick={onClose}
					className="absolute right-4 top-4 text-gray-400 transition-colors hover:text-white"
				>
					<X className="h-5 w-5" />
				</button>

				<h2 className="mb-5 text-lg font-bold text-white">Keyboard Shortcuts</h2>

				<div className="flex flex-col gap-2.5">
					{SHORTCUTS.map(({ key, description }) => (
						<div key={key + description} className="flex items-center justify-between">
							<span className="text-sm text-gray-300">{description}</span>
							<kbd className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-gray-300">
								{key}
							</kbd>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
