import { SimklSourceLink } from '@/components/SimklSourceLink';
import { beginSimklLogin } from '@/utils/simklLogin';
import { useState } from 'react';
import toast from 'react-hot-toast';

export function SimklAuthNotice({
	error,
	loading = false,
	message,
}: {
	error?: Error | null;
	loading?: boolean;
	message?: string;
}) {
	const [signingIn, setSigningIn] = useState(false);
	if (loading) {
		return (
			<div role="status" className="p-4 text-center text-white">
				<p>Loading Simkl account…</p>
				<SimklSourceLink />
			</div>
		);
	}
	const signIn = async () => {
		setSigningIn(true);
		try {
			window.location.assign(await beginSimklLogin(window.location.origin));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not start Simkl sign-in');
			setSigningIn(false);
		}
	};
	return (
		<div className="rounded border-2 border-indigo-500 bg-indigo-900/30 p-3 text-sm text-indigo-100">
			<p>
				{message ??
					(error
						? `Simkl account could not be loaded: ${error.message}`
						: 'Sign in to Simkl to open your custom lists.')}
			</p>
			<button
				type="button"
				disabled={signingIn}
				onClick={signIn}
				className="mt-2 rounded border border-indigo-400 px-3 py-1 disabled:opacity-50"
			>
				{signingIn ? 'Opening Simkl…' : 'Simkl Login'}
			</button>
			<div className="mt-2">
				<SimklSourceLink />
			</div>
		</div>
	);
}
