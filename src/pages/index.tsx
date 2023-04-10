import useMyAccount, { MyAccount } from '@/hooks/account';
import { useCurrentUser } from '@/hooks/auth';
import { withAuth } from '@/utils/withAuth';
import { useRouter } from 'next/router';
import { toast, Toaster } from 'react-hot-toast';

function IndexPage() {
	const router = useRouter();
	const user = useCurrentUser();
	const [myAccount, setMyAccount] = useMyAccount();

	const handleLibraryTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		setMyAccount({ ...myAccount, libraryType: event.target.value as MyAccount['libraryType'] });
		toast.success('Changes saved');
	};

	const handleLibraryClick = () => {
		router.push('/library');
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
			<Toaster position="top-right" />
			<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
				<rect x="25" y="25" width="150" height="150" fill="#2C3E50" rx="20" ry="20" />
				<circle cx="100" cy="100" r="60" fill="#00A0B0" />
				<path d="M85,65 L85,135 L135,100 Z" fill="#ECF0F1" />
				<path d="M60,90 Q80,60 100,90 T140,90" fill="#CC333F" />
				<path
					d="M75,121 L80,151 L90,136 L100,151 L110,136 L120,151 L125,121 Z"
					fill="#EDC951"
				/>
			</svg>
			{/* this is made by ChatGPT */}
			{user ? (
				<>
					<h1 className="text-2xl font-bold mb-4">Debrid Media Manager</h1>
					<div className="flex flex-col items-center">
						<p className="text-lg font-bold">Welcome back, {user.username}!</p>
						<div className="mt-4">
							<label htmlFor="libraryType" className="mr-2">
								You are building what type of library?
							</label>
							<select
								id="libraryType"
								value={myAccount!.libraryType}
								onChange={handleLibraryTypeChange}
								className="border rounded p-1"
							>
								<option value="1080p">1080p</option>
								<option value="2160p">2160p</option>
								<option value="1080pOr2160p">does not matter</option>
							</select>
						</div>
						<div className="flex mt-4">
							<button
								className="mr-2 bg-cyan-800 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleLibraryClick}
							>
								My Library
							</button>
							<button
								className="mr-2 bg-cyan-800 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleSearchClick}
							>
								Search
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
