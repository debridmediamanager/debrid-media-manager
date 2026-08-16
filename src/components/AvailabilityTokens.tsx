import { hasAvailabilityToken, toggleAvailabilityToken } from '@/utils/availabilityTokens';
import { FC } from 'react';

interface AvailabilityTokensProps {
	query: string;
	onQueryChange: (query: string) => void;
	rdKey?: string | null;
	adKey?: string | null;
	torboxKey?: string | null;
}

const AvailabilityTokens: FC<AvailabilityTokensProps> = ({
	query,
	onQueryChange,
	rdKey,
	adKey,
	torboxKey,
}) => {
	// Availability is only ever checked for services the user has a key for, so a
	// button for an unconfigured one would always filter down to nothing
	const services = [
		{
			token: 'is:rd',
			label: 'RD',
			title: 'Show only results cached in Real-Debrid',
			key: rdKey,
		},
		{ token: 'is:ad', label: 'AD', title: 'Show only results cached in AllDebrid', key: adKey },
		{
			token: 'is:tb',
			label: 'TB',
			title: 'Show only results cached in TorBox',
			key: torboxKey,
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
						key: 'any',
					},
				]
			: services;

	return (
		<div className="flex flex-row flex-wrap gap-1">
			{tokens.map(({ token, label, title }) => {
				const isActive = hasAvailabilityToken(query, token);
				return (
					<span
						key={token}
						onClick={() => onQueryChange(toggleAvailabilityToken(query, token))}
						title={title}
						aria-pressed={isActive}
						className={`cursor-pointer whitespace-nowrap rounded border px-2 py-0.5 text-xs transition-colors ${
							isActive
								? 'border-green-400 bg-green-600 text-white'
								: 'border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50'
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
