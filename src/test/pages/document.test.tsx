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
	it('renders SEO meta tags and dns-prefetch links', () => {
		const html = renderToStaticMarkup(<Document />);
		expect(html).toContain('name="description"');
		expect(html).toContain('property="og:title"');
		expect(html.match(/rel="dns-prefetch"/g)?.length ?? 0).toBeGreaterThan(5);
		expect(html.match(/rel="preconnect"/g)?.length ?? 0).toBeGreaterThan(5);
	});
});
