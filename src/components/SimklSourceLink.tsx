import Image from 'next/image';

export function SimklSourceLink({
	href = 'https://simkl.com/lists/',
	label = 'Powered by Simkl',
}: {
	href?: string;
	label?: string;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center justify-center gap-1 text-xs text-indigo-200 hover:text-white"
		>
			<Image
				src="https://us.simkl.in/img_favicon/v2/favicon-192x192.png"
				width={16}
				height={16}
				alt=""
				unoptimized
			/>
			{label}
		</a>
	);
}
