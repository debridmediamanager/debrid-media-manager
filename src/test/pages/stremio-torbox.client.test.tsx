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

vi.mock('@/hooks/torboxCastToken', () => ({
	useTorBoxCastToken: vi.fn(),
}));

vi.mock('@/components/CastSettingsPanel', () => ({
	CastSettingsPanel: () => <div data-testid="cast-settings-panel" />,
}));

vi.mock('@/utils/withAuth', () => ({
	withAuth: (Component: any) => Component,
}));

describe('StremioTorBoxPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should show TorBox required message when no credentials', async () => {
		const { useTorBoxCastToken } = await import('@/hooks/torboxCastToken');
		vi.mocked(useTorBoxCastToken).mockReturnValue(null);

		vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);

		const { StremioTorBoxPage } = await import('@/pages/stremio-torbox/index');
		render(<StremioTorBoxPage />);

		expect(screen.getByText('TorBox Required')).toBeInTheDocument();
		expect(
			screen.getByText('You must be logged in with TorBox to use the Stremio Cast feature.')
		).toBeInTheDocument();
		expect(screen.getByText('Login with TorBox')).toBeInTheDocument();
	});

	it('should show loading state when credentials exist but no token', async () => {
		const { useTorBoxCastToken } = await import('@/hooks/torboxCastToken');
		vi.mocked(useTorBoxCastToken).mockReturnValue(null);

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return 'test-api-key';
			return null;
		});

		const { StremioTorBoxPage } = await import('@/pages/stremio-torbox/index');
		render(<StremioTorBoxPage />);

		expect(screen.getByText('Debrid Media Manager is loading...')).toBeInTheDocument();
	});

	it('should render main page with token', async () => {
		const { useTorBoxCastToken } = await import('@/hooks/torboxCastToken');
		vi.mocked(useTorBoxCastToken).mockReturnValue('test-cast-token');

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return 'test-api-key';
			return null;
		});

		const { StremioTorBoxPage } = await import('@/pages/stremio-torbox/index');
		render(<StremioTorBoxPage />);

		expect(screen.getByText('DMM Cast for TorBox')).toBeInTheDocument();
		expect(screen.getByText('Cast from any device to Stremio')).toBeInTheDocument();
		expect(screen.getByText('Go Home')).toBeInTheDocument();
	});

	it('should render install buttons with token', async () => {
		const { useTorBoxCastToken } = await import('@/hooks/torboxCastToken');
		vi.mocked(useTorBoxCastToken).mockReturnValue('test-cast-token');

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return 'test-api-key';
			return null;
		});

		const { StremioTorBoxPage } = await import('@/pages/stremio-torbox/index');
		render(<StremioTorBoxPage />);

		const installLinks = screen.getAllByText('Install');
		expect(installLinks.length).toBeGreaterThanOrEqual(1);
	});

	it('should render manage casted links button', async () => {
		const { useTorBoxCastToken } = await import('@/hooks/torboxCastToken');
		vi.mocked(useTorBoxCastToken).mockReturnValue('test-cast-token');

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return 'test-api-key';
			return null;
		});

		const { StremioTorBoxPage } = await import('@/pages/stremio-torbox/index');
		render(<StremioTorBoxPage />);

		expect(screen.getByText('Manage Casted Links')).toBeInTheDocument();
	});
});
