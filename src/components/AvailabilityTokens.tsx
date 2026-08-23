import { hasAvailabilityToken, toggleAvailabilityToken } from '@/utils/availabilityTokens';
import { FC } from 'react';

interface AvailabilityTokensProps {
	query: string;
	onQueryChange: (query: string) => void;
	rdKey?: string | null;
	adKey?: string | null;
	torboxKey?: string | null;
	premiumizeKey?: string | null;
}

// Service colours match the library's torrent prefix badges (see utils/results.tsx):
// RD green, AD amber, TB indigo, PM the dark red of Premiumize's own icon.
// Written out in full because Tailwind only keeps class names it can find as
// literals.
const SERVICE_STYLES = {
	rd: {
		active: 'border-[#b5d496] bg-[#b5d496] text-black',
		idle: 'border-[#b5d496] bg-[#b5d496]/10 text-[#b5d496] hover:bg-[#b5d496]/25',
	},
	ad: {
		active: 'border-[#fbc730] bg-[#fbc730] text-black',
		idle: 'border-[#fbc730] bg-[#fbc730]/10 text-[#fbc730] hover:bg-[#fbc730]/25',
	},
	tb: {
		active: 'border-[#4f46e5] bg-[#4f46e5] text-white',
		idle: 'border-[#4f46e5] bg-[#4f46e5]/20 text-[#a5b4fc] hover:bg-[#4f46e5]/40',
	},
	pm: {
		active: 'border-[#aa0000] bg-[#aa0000] text-white',
		idle: 'border-[#aa0000] bg-[#aa0000]/20 text-[#f2a0a0] hover:bg-[#aa0000]/40',
	},
	// "any" is not a service, so it stays neutral rather than borrowing a colour
	any: {
		active: 'border-gray-300 bg-gray-200 text-black',
		idle: 'border-gray-500 bg-gray-700/40 text-gray-200 hover:bg-gray-600/50',
	},
} as const;

const AvailabilityTokens: FC<AvailabilityTokensProps> = ({
	query,
	onQueryChange,
	rdKey,
	adKey,
	torboxKey,
	premiumizeKey,
}) => {
	// Availability is only ever checked for services the user has a key for, so a
	// button for an unconfigured one would always filter down to nothing
	const services = [
		{
			token: 'is:rd',
			label: 'RD',
			title: 'Show only results cached in Real-Debrid',
			style: SERVICE_STYLES.rd,
			key: rdKey,
		},
		{
			token: 'is:ad',
			label: 'AD',
			title: 'Show only results cached in AllDebrid',
			style: SERVICE_STYLES.ad,
			key: adKey,
		},
		{
			token: 'is:tb',
			label: 'TB',
			title: 'Show only results cached in TorBox',
			style: SERVICE_STYLES.tb,
			key: torboxKey,
		},
		{
			token: 'is:pm',
			label: 'PM',
			title: 'Show only results cached in Premiumize',
			style: SERVICE_STYLES.pm,
			key: premiumizeKey,
		},
	].filter((service) => !!service.key);

	if (services.length === 0) return null;

	const tokens =
		services.length > 1
			? [
					...services,
					{
						token: 'is:cached',
						label: 'Any',
						title: 'Show only results cached in any of your debrid services',
						style: SERVICE_STYLES.any,
						key: 'any',
					},
				]
			: services;

	return (
		<div className="flex flex-row flex-wrap gap-1">
			{tokens.map(({ token, label, title, style }) => {
				const isActive = hasAvailabilityToken(query, token);
				return (
					<span
						key={token}
						onClick={() => onQueryChange(toggleAvailabilityToken(query, token))}
						title={title}
						aria-pressed={isActive}
						className={`cursor-pointer whitespace-nowrap rounded border px-2 py-0.5 text-xs transition-colors ${
							isActive ? style.active : style.idle
						}`}
					>
						{label} ✓
					</span>
				);
			})}
		</div>
	);
};

export default AvailabilityTokens;
