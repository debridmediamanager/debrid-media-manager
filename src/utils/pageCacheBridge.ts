type RouterEvents = {
	on(
		event: 'routeChangeComplete',
		handler: (url: string, opts: { shallow: boolean }) => void
	): void;
	off(
		event: 'routeChangeComplete',
		handler: (url: string, opts: { shallow: boolean }) => void
	): void;
};

/**
 * Asks the service worker to cache each completed application route's HTML.
 * The full navigation that loaded the page already went through the worker, and
 * a shallow route change (library paging, filters) loads no new document.
 */
export function bridgePageCache(events: RouterEvents, worker: ServiceWorkerContainer) {
	const cachePage = (path: string) => {
		if (!navigator.onLine) return;
		const url = new URL(path, window.location.origin);
		if (
			url.origin !== window.location.origin ||
			url.pathname === '/api' ||
			url.pathname.startsWith('/api/')
		)
			return;
		worker.controller?.postMessage({ type: 'CACHE_APP_DOCUMENT', url: url.href });
	};
	const cacheRoute = (path: string, { shallow }: { shallow: boolean }) => {
		if (!shallow) cachePage(path);
	};
	// A first install or a return online had no worker in the request path.
	const cacheCurrentPage = () => cachePage(window.location.href);
	events.on('routeChangeComplete', cacheRoute);
	window.addEventListener('online', cacheCurrentPage);
	worker.addEventListener('controllerchange', cacheCurrentPage);
	return () => {
		events.off('routeChangeComplete', cacheRoute);
		window.removeEventListener('online', cacheCurrentPage);
		worker.removeEventListener('controllerchange', cacheCurrentPage);
	};
}
