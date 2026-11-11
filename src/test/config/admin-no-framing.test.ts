import { describe, expect, it } from 'vitest';
import loadConfig from '../../../next.config.js';

describe('admin pages', () => {
	it('cannot be framed by another site', async () => {
		const config = await loadConfig();
		const headers = (await config.headers?.()) ?? [];
		const admin = headers.find((rule: { source: string }) => rule.source === '/admin/:path*');
		expect(admin?.headers).toEqual(
			expect.arrayContaining([
				{ key: 'X-Frame-Options', value: 'DENY' },
				{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
			])
		);
	});
});
