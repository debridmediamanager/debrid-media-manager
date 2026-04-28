import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...props
	}: {
		children: ReactNode;
		href: string;
		[key: string]: any;
	}) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt, ...props }: any) => (
		<span data-testid="mock-image" {...props}>
			{alt}
		</span>
	),
}));

vi.mock('@/hooks/allDebridCastToken', () => ({
	useAllDebridCastToken: vi.fn(),
}));

vi.mock('@/components/CastSettingsPanel', () => ({
	CastSettingsPanel: () => <div data-testid="cast-settings-panel" />,
}));

vi.mock('@/utils/withAuth', () => ({
	withAuth: (Component: any) => Component,
}));

describe('StremioAllDebridPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should show AllDebrid required message when no credentials', async () => {
		const { useAllDebridCastToken } = await import('@/hooks/allDebridCastToken');
		vi.mocked(useAllDebridCastToken).mockReturnValue(null);

		vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);

		const { StremioAllDebridPage } = await import('@/pages/stremio-alldebrid/index');
		render(<StremioAllDebridPage />);

		expect(screen.getByText('AllDebrid Required')).toBeInTheDocument();
		expect(
			screen.getByText(
				'You must be logged in with AllDebrid to use the Stremio Cast feature.'
			)
		).toBeInTheDocument();
		expect(screen.getByText('Login with AllDebrid')).toBeInTheDocument();
	});

	it('should show loading state when credentials exist but no token', async () => {
		const { useAllDebridCastToken } = await import('@/hooks/allDebridCastToken');
		vi.mocked(useAllDebridCastToken).mockReturnValue(null);

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === 'ad:apiKey') return 'test-api-key';
			return null;
		});

		const { StremioAllDebridPage } = await import('@/pages/stremio-alldebrid/index');
		render(<StremioAllDebridPage />);

		expect(screen.getByText('Debrid Media Manager is loading...')).toBeInTheDocument();
	});

	it('should render main page with token', async () => {
		const { useAllDebridCastToken } = await import('@/hooks/allDebridCastToken');
		vi.mocked(useAllDebridCastToken).mockReturnValue('test-cast-token');

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === 'ad:apiKey') return 'test-api-key';
			return null;
		});

		const { StremioAllDebridPage } = await import('@/pages/stremio-alldebrid/index');
		render(<StremioAllDebridPage />);

		expect(screen.getByText('DMM Cast for AllDebrid')).toBeInTheDocument();
		expect(screen.getByText('Cast from any device to Stremio')).toBeInTheDocument();
		expect(screen.getByText('Go Home')).toBeInTheDocument();
	});

	it('should render install buttons with token', async () => {
		const { useAllDebridCastToken } = await import('@/hooks/allDebridCastToken');
		vi.mocked(useAllDebridCastToken).mockReturnValue('test-cast-token');

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === 'ad:apiKey') return 'test-api-key';
			return null;
		});

		const { StremioAllDebridPage } = await import('@/pages/stremio-alldebrid/index');
		render(<StremioAllDebridPage />);

		const installLinks = screen.getAllByText('Install');
		expect(installLinks.length).toBeGreaterThanOrEqual(1);
	});

	it('should render manage casted links button', async () => {
		const { useAllDebridCastToken } = await import('@/hooks/allDebridCastToken');
		vi.mocked(useAllDebridCastToken).mockReturnValue('test-cast-token');

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === 'ad:apiKey') return 'test-api-key';
			return null;
		});

		const { StremioAllDebridPage } = await import('@/pages/stremio-alldebrid/index');
		render(<StremioAllDebridPage />);

		expect(screen.getByText('Manage Casted Links')).toBeInTheDocument();
	});
});
