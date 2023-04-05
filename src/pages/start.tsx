import { useDebridLogin } from '@/hooks/auth';

export default function StartPage() {
	const { loginWithRealDebrid } = useDebridLogin();

	return (
		<div className="flex flex-col items-center justify-center h-screen">
			{/* SEO Text */}
			<div className="my-8 text-center">
				<h1 className="text-3xl font-bold mb-4">Welcome to Debrid Media Manager</h1>
				<p className="text-lg">The media collection with truly unlimited storage size</p>
				<a target="_blank" href="https://docs.google.com/document/d/13enrfVXcGEEd0Yqb0PBTpGYrIvQpSfeIaAMZ_LiBDzM/edit?usp=sharing" className="text-lg underline decoration-dotted">
					Check the recommended setup here
				</a>
			</div>

			{/* Login Buttons */}
			<div className="flex flex-col items-center">
				<p className="text-sm">
					Please login with one of the supported Debrid services below
				</p>
				{/* RealDebrid */}
				<div className="flex flex-row">
					<button
						className="px-4 py-2 m-2 text-white bg-blue-500 rounded hover:bg-blue-600"
						onClick={loginWithRealDebrid}
					>
						Login with Real Debrid
					</button>
					<a
						className="px-4 py-2 m-2 text-white bg-green-500 rounded hover:bg-green-600"
						href="http://real-debrid.com/?id=440161"
						target="_blank"
						rel="noopener noreferrer"
					>
						Create an account with RealDebrid
					</a>
				</div>

				{/* AllDebrid */}
				<div className="flex flex-row">
					<button
						className="px-4 py-2 m-2 text-white bg-blue-500 disabled:opacity-50 disabled:bg-gray-500 rounded hover:bg-blue-600"
						disabled
						title="Coming soon!"
					>
						Login with AllDebrid
					</button>
				</div>

				<h2 className="text-l text-slate-500 font-bold mt-2 mb-2">Data Storage Policy</h2>
				<p className="text-sm text-slate-500 flex-row text-center">
					Please note that no data is stored in our servers
					<br />
					You can inspect every request if you want
					<br />
					Everything is stored on your browser&apos;s local storage
				</p>
			</div>
		</div>
	);
}
