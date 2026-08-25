import { ServiceCard } from '@/components/ServiceCard';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/modals/modal', () => ({
	__esModule: true,
	default: { fire: vi.fn(), DismissReason: { cancel: 'cancel' } },
}));

vi.mock('lucide-react', () => ({
	__esModule: true,
	Check: () => <svg />,
	X: () => <svg />,
}));

const noop = () => undefined;

describe('ServiceCard error state', () => {
	// A failed profile call used to fall through to the `user ? ... : login`
	// branch, so a signed-in user was shown a login button with no hint that
	// anything had gone wrong.
	it('reports the failure instead of offering to log in', () => {
		render(
			<ServiceCard
				service="tb"
				user={null}
				error={new Error('TorBox profile unavailable')}
				onTraktLogin={noop}
				onLogout={noop}
			/>
		);

		expect(screen.getByRole('button', { name: /TorBox did not load/i })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^Login/i })).not.toBeInTheDocument();
	});

	it('names the provider that failed', () => {
		render(
			<ServiceCard
				service="rd"
				user={null}
				error={new Error('boom')}
				onTraktLogin={noop}
				onLogout={noop}
			/>
		);

		expect(
			screen.getByRole('button', { name: /Real-Debrid did not load/i })
		).toBeInTheDocument();
	});

	it('falls through to the normal branches when there is no error', () => {
		render(<ServiceCard service="tb" user={null} onTraktLogin={noop} onLogout={noop} />);

		expect(screen.queryByText(/did not load/i)).not.toBeInTheDocument();
	});
});
