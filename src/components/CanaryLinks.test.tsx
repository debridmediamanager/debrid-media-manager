import CanaryLinks from '@/components/CanaryLinks';
import { TRAPS_PER_ROTATION, classifyCanary } from '@/utils/canary';
import { render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('CanaryLinks', () => {
	it('publishes the current trap rotation', async () => {
		const { container } = render(<CanaryLinks />);

		await waitFor(() => {
			expect(container.querySelectorAll('a')).toHaveLength(TRAPS_PER_ROTATION);
		});

		const hrefs = Array.from(container.querySelectorAll('a')).map((a) =>
			a.getAttribute('href')
		);
		for (const href of hrefs) {
			const imdbId = href?.replace('/movie/', '');
			expect(classifyCanary(imdbId)).toBe('trap');
		}
	});

	it('renders nothing a user can see or reach', async () => {
		const { container } = render(<CanaryLinks />);

		await waitFor(() => {
			expect(container.querySelectorAll('a').length).toBeGreaterThan(0);
		});

		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper).toHaveAttribute('aria-hidden', 'true');
		expect(wrapper).toHaveAttribute('hidden');
		expect(wrapper.style.display).toBe('none');
		// Hidden content is excluded from the accessibility tree, so a screen
		// reader never announces the traps either.
		expect(screen.queryAllByRole('link')).toHaveLength(0);

		for (const anchor of Array.from(container.querySelectorAll('a'))) {
			expect(anchor).toHaveAttribute('tabindex', '-1');
			expect(anchor).toHaveAttribute('rel', 'nofollow');
		}
	});

	it('keeps the traps out of the server-rendered markup', () => {
		// Effects do not run during SSR, so nothing that merely fetches the page
		// sees a trap - only something driving a real browser does.
		expect(renderToStaticMarkup(<CanaryLinks />)).toBe('');
	});
});
