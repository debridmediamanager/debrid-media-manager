import { useCurrentUser } from '@/hooks/auth';
import { withAuth } from '@/utils/withAuth';
import { useRouter } from 'next/router';

function IndexPage() {
	const router = useRouter();
	const rdUser = useCurrentUser();

	const handleMyAccountClick = () => {
		router.push('/account');
	};

	const handleMoviesClick = () => {
		router.push('/realdebrid/movies');
	};

	const handleSearchClick = () => {
		router.push('/search');
	};

	const handleLogout = () => {
		if (typeof window === 'undefined') {
			// Running on the server, return null
			return null;
		}
		localStorage.clear();
		router.push('/start');
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			{rdUser ? (
				<>
					<h1 className="text-2xl font-bold mb-4">Debrid Media Manager</h1>
					<div className="flex flex-col items-center">
						<p className="text-lg font-bold">Welcome back, {rdUser.username}!</p>
						<p className="text-lg">
							You are building a 2160p library.
							{/* <a href="">Click to change to 1080p.</a> */}
						</p>
						<div className="flex mt-4">
							<button
								className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleMyAccountClick}
							>
								My Account
							</button>
							<button
								className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleMoviesClick}
							>
								My Movies
							</button>
							<button
								className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleSearchClick}
							>
								Search Movies
							</button>
						</div>
						<div className="flex mt-4">
							<button
								className="mr-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleLogout}
							>
								Logout
							</button>
						</div>
					</div>
				</>
			) : (
				<h1 className="text-2xl font-bold">Debrid Media Manager is loading...</h1>
			)}
		</div>
	);
}

export default withAuth(IndexPage);
