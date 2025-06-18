import React from 'react';

const MediaInfoSkeleton: React.FC = () => {
	return (
		<div className="min-h-screen max-w-full bg-gray-900 text-gray-100">
			<div className="grid auto-cols-auto grid-flow-col auto-rows-auto gap-2 p-4">
				{/* Poster skeleton */}
				<div className="row-span-5 h-[300px] w-[200px] animate-pulse rounded bg-gray-800 shadow-lg" />

				<div className="col-span-4 space-y-4">
					{/* Go Home button skeleton */}
					<div className="flex justify-end">
						<div className="h-8 w-20 animate-pulse rounded bg-gray-800" />
					</div>

					{/* Title skeleton */}
					<div className="h-8 w-96 animate-pulse rounded bg-gray-800" />

					{/* Description skeleton */}
					<div className="space-y-2">
						<div className="h-4 w-full animate-pulse rounded bg-gray-800" />
						<div className="h-4 w-5/6 animate-pulse rounded bg-gray-800" />
						<div className="h-4 w-4/6 animate-pulse rounded bg-gray-800" />
					</div>

					{/* Buttons skeleton */}
					<div className="flex gap-2">
						<div className="h-8 w-24 animate-pulse rounded bg-gray-800" />
						<div className="h-8 w-24 animate-pulse rounded bg-gray-800" />
						<div className="h-8 w-24 animate-pulse rounded bg-gray-800" />
					</div>
				</div>
			</div>

			{/* Search bar skeleton */}
			<div className="mx-2 mb-1 flex items-center border-b-2 border-gray-600 py-2">
				<div className="h-8 w-full animate-pulse rounded bg-gray-800" />
			</div>

			{/* Results grid skeleton */}
			<div className="mx-1 my-1 grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
				{[...Array(12)].map((_, i) => (
					<div key={i} className="space-y-2 rounded-lg border-2 border-gray-700 p-2">
						<div className="h-4 w-full animate-pulse rounded bg-gray-800" />
						<div className="h-3 w-3/4 animate-pulse rounded bg-gray-800" />
						<div className="flex gap-1">
							<div className="h-6 w-16 animate-pulse rounded bg-gray-800" />
							<div className="h-6 w-16 animate-pulse rounded bg-gray-800" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
};

export default MediaInfoSkeleton;
