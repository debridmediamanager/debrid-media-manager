import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storedValues, setIntervalMock, routerReplaceMock, getSafeRedirectPathMock } = vi.hoisted(
	() => ({
		storedValues: new Map<string, any>(),
		setIntervalMock: vi.fn(),
		routerReplaceMock: vi.fn(),
		getSafeRedirectPathMock: vi.fn(),
	})
);

const getDeviceCodeMock = vi.fn();
const getCredentialsMock = vi.fn();
const getTokenMock = vi.fn();

vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: (key: string) => {
		return [
			storedValues.get(key) ?? null,
			(newValue: any) => {
				const resolved =
					typeof newValue === 'function'
						? newValue(storedValues.get(key) ?? null)
						: newValue;
				storedValues.set(key, resolved);
			},
		];
	},
}));

vi.mock('@/services/realDebrid', () => ({
	__esModule: true,
	getDeviceCode: () => getDeviceCodeMock(),
	getCredentials: (...args: any[]) => getCredentialsMock(...args),
	getToken: (...args: any[]) => getTokenMock(...args),
}));

vi.mock('@/utils/clearLocalStorage', () => ({
	__esModule: true,
	clearRdKeys: vi.fn(),
}));

vi.mock('@/utils/router', () => ({
	__esModule: true,
	getSafeRedirectPath: (...args: any[]) => getSafeRedirectPathMock(...args),
}));

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => ({
		isReady: true,
		query: { redirect: '/library' },
		replace: routerReplaceMock,
	}),
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import RealDebridLoginPage from '@/pages/realdebrid/login';

describe('RealDebridLoginPage', () => {
	const originalSetInterval = global.setInterval;

	beforeEach(() => {
		storedValues.clear();
		getDeviceCodeMock.mockReset();
		getCredentialsMock.mockReset();
		getTokenMock.mockReset();
		routerReplaceMock.mockReset();
		getSafeRedirectPathMock.mockReset().mockReturnValue('/');
		(global.navigator as any).clipboard = {
			writeText: vi.fn().mockResolvedValue(undefined),
		};
		setIntervalMock.mockImplementation((cb: any) => {
			cb();
			return 1 as any;
		});
		global.setInterval = setIntervalMock as any;
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
	});

	it('requests a device code and copies the user code when credentials are missing', async () => {
		getDeviceCodeMock.mockResolvedValue({
			verification_url: 'https://real-debrid.com/device',
			user_code: 'ABCD',
			interval: 1,
			device_code: 'device123',
		});
		getCredentialsMock.mockResolvedValue({
			client_id: 'client123',
			client_secret: 'secret123',
		});

		render(<RealDebridLoginPage />);

		await waitFor(() => expect(getDeviceCodeMock).toHaveBeenCalled());
		expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith('ABCD');
		expect(storedValues.get('rd:refreshToken')).toBe('device123');
		await waitFor(() => expect(storedValues.get('rd:clientId')).toBe('client123'));
		expect(storedValues.get('rd:clientSecret')).toBe('secret123');
		expect(screen.getByText(/enter this/i)).toHaveTextContent('ABCD');
	});

	it('refreshes the access token when stored credentials exist', async () => {
		storedValues.set('rd:clientId', 'client123');
		storedValues.set('rd:clientSecret', 'secret123');
		storedValues.set('rd:refreshToken', 'refresh-token');
		getTokenMock.mockResolvedValue({ access_token: 'new-access', expires_in: 3600 });

		render(<RealDebridLoginPage />);

		await waitFor(() => expect(getTokenMock).toHaveBeenCalled());
		expect(storedValues.get('rd:accessToken')).toBe('new-access');
	});

	it('redirects to the requested path when already authenticated', () => {
		storedValues.set('rd:accessToken', 'existing-token');
		getSafeRedirectPathMock.mockReturnValue('/library');

		render(<RealDebridLoginPage />);

		expect(routerReplaceMock).toHaveBeenCalledWith('/library');
	});
});
