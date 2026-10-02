import type { SimklUser } from '@/services/simkl';
import { List } from 'lucide-react';
import Link from 'next/link';

interface SimklSectionProps {
	simklUser: SimklUser | null;
}

/**
 * Custom lists are the only Simkl surface DMM reads, so unlike `TraktSection`
 * there is nothing here for a signed-out visitor: no browse rows, no calendar.
 * The section appears with the account and disappears with it.
 */
export function SimklSection({ simklUser }: SimklSectionProps) {
	if (!simklUser) return null;

	return (
		<div className="grid w-full grid-cols-1 gap-3">
			<Link
				href="/simkl/mylists"
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-indigo-500 bg-indigo-900/30 p-3 text-sm font-medium text-indigo-100 transition-colors hover:bg-indigo-800/50"
			>
				<List size={16} strokeWidth={2} className="shrink-0 text-green-400" />
				Simkl custom lists
			</Link>
		</div>
	);
}
