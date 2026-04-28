import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Logo', () => ({
	__esModule: true,
	Logo: () => <div data-testid="logo" />,
}));

vi.mock('@/components/SettingsSection', () => ({
	__esModule: true,
	SettingsSection: () => <div data-testid="settings-section" />,
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	Toaster: () => <div data-testid="toaster" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

import SettingsPage from '@/pages/settings';

describe('SettingsPage', () => {
	it('renders logo, toast, settings section, and back link', () => {
		render(<SettingsPage />);

		expect(screen.getByTestId('logo')).toBeInTheDocument();
		expect(screen.getByTestId('toaster')).toBeInTheDocument();
		expect(screen.getByTestId('settings-section')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
			'href',
			'/'
		);
	});
});
