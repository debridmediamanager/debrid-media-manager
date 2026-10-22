import toast from 'react-hot-toast';

/** Bulk episode totals stay available until the viewer dismisses them. */
export function showEpisodeSummary(message: string, successful: boolean) {
	const notify = successful ? toast.success : toast.error;
	return notify(
		(t) => (
			<div className="flex items-center gap-3">
				<span>{message}</span>
				<button
					type="button"
					aria-label="Dismiss episode summary"
					className="shrink-0 rounded px-2 py-1 text-sm underline"
					onClick={() => toast.dismiss(t.id)}
				>
					Dismiss
				</button>
			</div>
		),
		{ duration: Infinity }
	);
}
