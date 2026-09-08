import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every DMM Cast page shows a "<provider> Required" card to a member who is
 * signed in with some *other* provider, and that card's link is the only way
 * out of it.
 *
 * Two ways it has gone wrong, both reported from production: the link pointed
 * at a path with no page behind it (`/alldebrid`, `/premiumize` - both 404),
 * and it carried no `redirect`, so signing in dropped the member on the home
 * page instead of the cast page they were trying to reach.
 */

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, href, ...props }: any) => (
		<a href={typeof href === 'string' ? href : String(href)} {...props}>
			{children}
		</a>
	),
}));

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt }: any) => <span data-testid="mock-image">{alt}</span>,
}));

vi.mock('@/components/CastSettingsPanel', () => ({
	CastSettingsPanel: () => <div data-testid="cast-settings-panel" />,
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (Component: any) => Component,
}));

vi.mock('@/hooks/castToken', () => ({ useCastToken: () => undefined }));
vi.mock('@/hooks/allDebridCastToken', () => ({ useAllDebridCastToken: () => undefined }));
vi.mock('@/hooks/torboxCastToken', () => ({ useTorBoxCastToken: () => undefined }));
vi.mock('@/hooks/premiumizeCastToken', () => ({ usePremiumizeCastToken: () => undefined }));
vi.mock('@/hooks/offcloudCastToken', () => ({ useOffcloudCastToken: () => undefined }));
vi.mock('@/hooks/debridLinkCastToken', () => ({ useDebridLinkCastToken: () => undefined }));

// The login routes that actually exist, read off the pages directory rather
// than typed out - a link to a path with no page here is the 404 this guards.
// `import.meta.glob` is a Vite builtin; the project's tsconfig does not pull in
// vite/client, so it needs the cast to typecheck.
const LOGIN_ROUTES = new Set(
	Object.keys(
		(import.meta as unknown as { glob: (p: string) => Record<string, unknown> }).glob(
			'/src/pages/*/login.tsx'
		)
	).map((p) => p.replace('/src/pages', '').replace('.tsx', ''))
);

const CAST_PAGES = [
	{ path: '/stremio', provider: 'Real-Debrid', mod: () => import('@/pages/stremio/index') },
	{
		path: '/stremio-alldebrid',
		provider: 'AllDebrid',
		mod: () => import('@/pages/stremio-alldebrid/index'),
	},
	{
		path: '/stremio-torbox',
		provider: 'TorBox',
		mod: () => import('@/pages/stremio-torbox/index'),
	},
	{
		path: '/stremio-premiumize',
		provider: 'Premiumize',
		mod: () => import('@/pages/stremio-premiumize/index'),
	},
	{
		path: '/stremio-offcloud',
		provider: 'Offcloud',
		mod: () => import('@/pages/stremio-offcloud/index'),
	},
	{
		path: '/stremio-debridlink',
		provider: 'Debrid-Link',
		mod: () => import('@/pages/stremio-debridlink/index'),
	},
];

describe('DMM Cast pages: the "<provider> Required" card', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it('knows about every login route', () => {
		// Guards the guard: if login pages ever move, the glob above must not
		// quietly go empty and pass everything.
		expect(LOGIN_ROUTES.size).toBe(6);
	});

	it.each(CAST_PAGES)(
		'$path sends $provider sign-in back to the cast page',
		async ({ path, provider, mod }) => {
			const Page = Object.values(await mod()).find(
				(v): v is React.ComponentType => typeof v === 'function' && /^Stremio/.test(v.name)
			);
			if (!Page) throw new Error(`no page component exported from ${path}`);

			render(<Page />);
			expect(screen.getByText(new RegExp(`${provider} Required`, 'i'))).toBeInTheDocument();

			const href =
				screen
					.getByRole('link', { name: new RegExp(`Login with ${provider}`, 'i') })
					.getAttribute('href') ?? '';
			const [route, query] = href.split('?');

			expect(LOGIN_ROUTES, `${href} has no page behind it`).toContain(route);
			expect(new URLSearchParams(query).get('redirect')).toBe(path);
		}
	);
});
