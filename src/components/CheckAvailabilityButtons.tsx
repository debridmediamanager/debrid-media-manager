import type { DebridService } from '@/hooks/useAvailabilityCheck';
import { Loader2, Search } from 'lucide-react';

interface CheckAvailabilityButtonsProps {
	rdKey: string | null;
	adKey: string | null;
	debridLinkKey: string | null;
	isAnyChecking: boolean;
	onCheck: (services: DebridService[]) => void;
}

const DL_NOTE = 'Each Debrid-Link hit is added and removed again, which is why it is a button.';

// Class names written out whole: the build cannot see an assembled one.
const SINGLE: Record<'RD' | 'AD' | 'DL', { button: string; icon: string; title?: string }> = {
	RD: {
		button: 'border-yellow-500 bg-yellow-900/30 text-yellow-100 hover:bg-yellow-800/50',
		icon: 'text-yellow-500',
	},
	AD: {
		button: 'border-orange-500 bg-orange-900/30 text-orange-100 hover:bg-orange-800/50',
		icon: 'text-orange-500',
	},
	DL: {
		button: 'border-[#38bdf8] bg-[#38bdf8]/20 text-sky-100 hover:bg-[#38bdf8]/40',
		icon: 'text-sky-400',
		title: `Asks Debrid-Link about every row shown. ${DL_NOTE}`,
	},
};

/**
 * The header's on-demand cache checks. TorBox, Premiumize and Offcloud are
 * checked automatically, so only RD, AD and Debrid-Link get a button. Holding
 * two or more of them, one "Check all" asks each in turn; the hook runs one
 * check at a time anyway.
 */
export default function CheckAvailabilityButtons({
	rdKey,
	adKey,
	debridLinkKey,
	isAnyChecking,
	onCheck,
}: CheckAvailabilityButtonsProps) {
	const services = (
		[
			['RD', rdKey],
			['AD', adKey],
			['DL', debridLinkKey],
		] as const
	)
		.filter(([, key]) => key)
		.map(([service]) => service);
	if (services.length === 0) return null;

	const single = services.length === 1 ? SINGLE[services[0]] : null;
	const name = single ? services[0] : 'all';
	const title = single
		? single.title
		: `Asks ${services.join(', ')} about every row shown.${services.includes('DL') ? ` ${DL_NOTE}` : ''}`;
	return (
		<button
			className={`mt-0 mr-2 mb-1 rounded border-2 p-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${single?.button ?? SINGLE.RD.button}`}
			onClick={() => onCheck([...services])}
			disabled={isAnyChecking}
			title={title}
		>
			<b className="flex items-center justify-center">
				{isAnyChecking ? (
					<Loader2
						className={`mr-1 h-3 w-3 animate-spin ${single?.icon ?? SINGLE.RD.icon}`}
					/>
				) : (
					<Search className={`mr-1 h-3 w-3 ${single?.icon ?? SINGLE.RD.icon}`} />
				)}
				{isAnyChecking ? `Checking ${name}...` : `Check ${name}`}
			</b>
		</button>
	);
}
