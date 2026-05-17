import Link from 'next/link';
import { ReactNode } from 'react';

type ButtonVariant = 'orange' | 'yellow' | 'amber' | 'slate' | 'green';

interface LibraryLinkButtonProps {
	href: string;
	variant: ButtonVariant;
	children: ReactNode;
	size?: 'xs' | 'sm';
	active?: boolean;
	onClick?: (e: React.MouseEvent) => void;
}

const variantStyles: Record<ButtonVariant, string> = {
	orange: 'border-orange-500 bg-orange-900/30 text-orange-100 hover:bg-orange-800/50',
	yellow: 'border-yellow-500 bg-yellow-900/30 text-yellow-100 hover:bg-yellow-800/50',
	amber: 'border-amber-500 bg-amber-900/30 text-amber-100 hover:bg-amber-800/50',
	slate: 'border-slate-500 bg-slate-900/30 text-slate-100 hover:bg-slate-800/50',
	green: 'border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50',
};

const activeVariantStyles: Record<ButtonVariant, string> = {
	orange: 'border-orange-400 bg-orange-500/60 text-white ring-1 ring-orange-400/50',
	yellow: 'border-yellow-400 bg-yellow-500/60 text-white ring-1 ring-yellow-400/50',
	amber: 'border-amber-400 bg-amber-500/60 text-white ring-1 ring-amber-400/50',
	slate: 'border-slate-400 bg-slate-500/60 text-white ring-1 ring-slate-400/50',
	green: 'border-green-400 bg-green-500/60 text-white ring-1 ring-green-400/50',
};

export default function LibraryLinkButton({
	href,
	variant,
	children,
	size = 'xs',
	active = false,
	onClick,
}: LibraryLinkButtonProps) {
	const sizeClasses = size === 'xs' ? 'text-xs py-0.5' : 'text-xs py-0';
	const styles = active ? activeVariantStyles[variant] : variantStyles[variant];

	return (
		<Link
			href={active ? '/library?page=1' : href}
			className={`mb-1 mr-2 rounded border-2 px-1 ${sizeClasses} ${styles} transition-colors`}
			onClick={onClick}
		>
			{children}
		</Link>
	);
}
