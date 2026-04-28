import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosPostMock } = vi.hoisted(() => ({
	axiosPostMock: vi.fn(),
}));
const { toastMock } = vi.hoisted(() => ({
	toastMock: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('axios', () => ({
	__esModule: true,
	default: {
		post: (...args: any[]) => axiosPostMock(...args),
	},
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
}));

vi.mock('lucide-react', () => ({
	__esModule: true,
	AlertTriangle: () => <svg data-testid="alert-icon" />,
}));

import ReportButton from './ReportButton';

describe('ReportButton', () => {
	beforeEach(() => {
		axiosPostMock.mockReset();
		toastMock.success.mockReset();
		toastMock.error.mockReset();
	});

	it('opens the dialog and submits a report successfully', async () => {
		axiosPostMock.mockResolvedValue({});
		render(<ReportButton hash="hash" imdbId="tt123" userId="user1" isShow />);

		fireEvent.click(screen.getByRole('button', { name: /Report/i }));
		fireEvent.click(screen.getByText(/XXX \/ Porn Content/i));

		await waitFor(() => expect(axiosPostMock).toHaveBeenCalled());
		expect(axiosPostMock).toHaveBeenCalledWith('/api/report', {
			hash: 'hash',
			imdbId: 'tt123',
			userId: 'user1',
			type: 'porn',
		});
		expect(toastMock.success).toHaveBeenCalledWith('Report submitted.');
	});

	it('renders the season-specific action for shows and handles errors', async () => {
		axiosPostMock.mockRejectedValue(new Error('fail'));
		render(<ReportButton hash="hash" imdbId="tt999" userId="user2" isShow />);

		fireEvent.click(screen.getByRole('button', { name: /Report/i }));
		fireEvent.click(screen.getByText(/Tagged for Wrong Season/i));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith('Report submission failed.')
		);
	});
});
