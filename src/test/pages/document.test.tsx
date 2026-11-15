import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/document', () => ({
	__esModule: true,
	Html: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	Head: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	Main: () => <div data-testid="next-main" />,
	NextScript: () => <div data-testid="next-script" />,
}));

import Document from '@/pages/_document';

describe('Custom Document', () => {
	it('renders SEO meta tags', () => {
		const html = renderToStaticMarkup(<Document />);
		expect(html).toContain('name="description"');
		expect(html).toContain('property="og:title"');
	});

	// A self-hosted copy never loads posters from DMM's poster cache, so the page no longer
	// names those hosts itself: the inline script adds them on debridmediamanager.com only.
	it('preconnects to the poster hosts only through the host-gated script', () => {
		const html = renderToStaticMarkup(<Document />);
		expect(html).toContain('<script id="dmm-poster-preconnect">');
		expect(html).not.toMatch(/<link[^>]*posters\d\.debridmediamanager\.com/);
	});

	// Fizzy #587: a 404ed chunk left the SSR loading screen with no way out.
	it('carries the inline boot guard outside the JS bundle', () => {
		const html = renderToStaticMarkup(<Document />);
		expect(html).toContain('<script id="dmm-boot-guard">');
		expect(html).toContain("'/_next/static/'");
		expect(html).toContain('__dmmHydrated');
	});
});
