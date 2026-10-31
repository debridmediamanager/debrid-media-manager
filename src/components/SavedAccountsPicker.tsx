import {
	hasActiveLogin,
	listSavedAccounts,
	switchToSavedAccount,
	type AccountIdentity,
	type SavedAccount,
} from '@/utils/savedAccounts';
import { useEffect, useState } from 'react';

/**
 * The saved logins for one provider, read after mount: localStorage is not
 * there on the server, and a list rendered only on the client would otherwise
 * mismatch the hydrated markup.
 */
export function useSavedAccounts(prefix: string): SavedAccount[] {
	return useSavedAccountsStore(prefix).accounts;
}

function useSavedAccountsStore(prefix: string) {
	const [state, setState] = useState<{ accounts: SavedAccount[]; activeLogin: boolean }>({
		accounts: [],
		activeLogin: false,
	});
	useEffect(() => {
		const read = () =>
			setState({ accounts: listSavedAccounts(prefix), activeLogin: hasActiveLogin(prefix) });
		read();
		window.addEventListener('storage', read);
		window.addEventListener('local-storage', read);
		return () => {
			window.removeEventListener('storage', read);
			window.removeEventListener('local-storage', read);
		};
	}, [prefix]);
	return state;
}

interface Props {
	prefix: string;
	/** The signed-in account, parked when another is picked. Null on a login page. */
	current: AccountIdentity | null;
	/** Full page load after the swap; auth state is a singleton only a reload resets. */
	afterSwitch?: () => void;
}

/** Renders nothing for the single-account majority. */
export function SavedAccountsPicker({ prefix, current, afterSwitch }: Props) {
	const { accounts, activeLogin } = useSavedAccountsStore(prefix);
	const [busy, setBusy] = useState(false);
	// On a login page (no `current`) an active login is one nobody identified;
	// offering a swap would sweep it unsaved, so the row waits for a logout.
	if (!accounts.length || (!current && activeLogin)) return null;

	const pick = async (id: string) => {
		setBusy(true);
		if (await switchToSavedAccount(prefix, id, current)) {
			(afterSwitch ?? (() => window.location.reload()))();
			return;
		}
		setBusy(false);
	};

	return (
		<div className="flex flex-wrap items-center justify-center gap-2 text-xs text-gray-300">
			<span>{current ? 'Switch to' : 'Continue as'}</span>
			{accounts.map((account) => (
				<button
					key={account.id}
					type="button"
					disabled={busy}
					onClick={() => pick(account.id)}
					className="haptic-sm rounded border border-gray-500 bg-gray-800/30 px-2 py-0.5 text-gray-100 transition-colors hover:bg-gray-700/50 disabled:opacity-50"
				>
					{account.label}
				</button>
			))}
		</div>
	);
}
