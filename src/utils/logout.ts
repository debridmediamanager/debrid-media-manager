import { NextRouter } from 'next/router';

export function handleLogout(prefix: string | undefined, router: NextRouter) {
	if (prefix) {
		let i = localStorage.length - 1;
		while (i >= 0) {
			const key = localStorage.key(i);
			if (key && key.startsWith(prefix)) localStorage.removeItem(key);
			i--;
		}
		router.reload();
	} else {
		localStorage.clear();
		router.push('/start');
	}
}
