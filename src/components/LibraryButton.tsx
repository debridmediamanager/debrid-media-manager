import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant =
	'orange' | 'green' | 'indigo' | 'red' | 'teal' | 'yellow' | 'amber' | 'slate' | 'cyan';

interface LibraryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant: ButtonVariant;
	children: ReactNode;
	size?: 'xs' | 'sm';
	showCount?: number;
}

const variantStyles: Record<ButtonVariant, string> = {
	orange: 'border-orange-500 bg-orange-900/30 text-orange-100 hover:bg-orange-800/50',
	green: 'border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50',
	indigo: 'border-indigo-500 bg-indigo-900/30 text-indigo-100 hover:bg-indigo-800/50',
	red: 'border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50',
	teal: 'border-teal-500 bg-teal-900/30 text-teal-100 hover:bg-teal-800/50',
	yellow: 'border-yellow-500 bg-yellow-900/30 text-yellow-100 hover:bg-yellow-800/50',
	amber: 'border-amber-500 bg-amber-900/30 text-amber-100 hover:bg-amber-800/50',
	slate: 'border-slate-500 bg-slate-900/30 text-slate-100 hover:bg-slate-800/50',
	cyan: 'border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50',
};

export default function LibraryButton({
	variant,
	children,
	size = 'sm',
	showCount,
	className = '',
	disabled,
	...props
}: LibraryButtonProps) {
	const sizeClasses = size === 'xs' ? 'text-xs' : 'text-[0.6rem]';
	const disabledClasses = disabled ? 'cursor-not-allowed opacity-60' : '';

	return (
		<button
			className={`mr-2 mb-1 shrink-0 rounded border-2 px-1 py-0.5 whitespace-nowrap ${sizeClasses} ${variantStyles[variant]} transition-colors ${disabledClasses} ${className}`}
			disabled={disabled}
			{...props}
		>
			{children}
			{showCount !== undefined && showCount > 0 && ` (${showCount})`}
		</button>
	);
}
