interface LibrarySizeProps {
	torrentCount: number;
	totalBytes: number;
	isLoading: boolean;
}

const ONE_GIGABYTE = 1024 * 1024 * 1024;

export default function LibrarySize({ torrentCount, totalBytes, isLoading }: LibrarySizeProps) {
	return (
		<span className="whitespace-nowrap text-sm">
			{torrentCount} torrents{' '}
			{isLoading
				? '💭'
				: totalBytes / ONE_GIGABYTE / 1024 > 10000
					? '😱'
					: totalBytes / ONE_GIGABYTE / 1024 > 1000
						? '😨'
						: totalBytes / ONE_GIGABYTE / 1024 > 100
							? '😮'
							: totalBytes / ONE_GIGABYTE / 1024 > 10
								? '🙂'
								: totalBytes / ONE_GIGABYTE / 1024 > 1
									? '😐'
									: '🙁'}{' '}
			<span className="whitespace-nowrap text-sm">
				{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB
			</span>
		</span>
	);
}
