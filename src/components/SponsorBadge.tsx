import { useSponsor } from '@/hooks/useSponsor';
import { Heart } from 'lucide-react';
import { FC } from 'react';

interface SponsorBadgeProps {
	/** Show the linked GitHub account next to the badge. */
	showName?: boolean;
	className?: string;
}

/**
 * Cosmetic marker for a linked sponsor. Renders nothing for everyone else.
 *
 * Decorative by design - it reads an unverified localStorage token. Gate real
 * functionality with requireSponsor on the server instead.
 */
export const SponsorBadge: FC<SponsorBadgeProps> = ({ showName = false, className = '' }) => {
	const { isSponsor, githubUsername } = useSponsor();

	if (!isSponsor) return null;

	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full border border-pink-400/50 bg-pink-500/15 px-2 py-0.5 text-xs font-medium text-pink-200 ${className}`}
			title={githubUsername ? `Sponsor · ${githubUsername}` : 'Sponsor'}
		>
			<Heart className="h-3 w-3 fill-pink-300 text-pink-300" />
			Sponsor
			{showName && githubUsername ? (
				<span className="text-pink-300/80">· {githubUsername}</span>
			) : null}
		</span>
	);
};

export default SponsorBadge;
