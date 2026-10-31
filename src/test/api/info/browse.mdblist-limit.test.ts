import limitReached from '@/test/fixtures/mdblist/legacy-lists-search-limit-reached.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('@/services/database/mdblistCache', () => ({
	getMdblistCacheService: () => ({
		getWithMetadata: vi.fn().mockResolvedValue(null),
		cacheList: vi.fn(),
	}),
}));

// The real client and shuffle together: on 2026-10-30 MDBList answered list
// searches with this body and HTTP 200, and this route never returned, which
// froze each web replica until Docker's health check killed it.
describe('/api/info/browse when MDBList answers with a limit body', () => {
	it('answers 500 instead of hanging', async () => {
		vi.stubEnv('MDBLIST_KEY', 'test-api-key');
		vi.mocked(axios.get).mockResolvedValue({ data: limitReached });
		const { default: handler } = await import('@/pages/api/info/browse');
		const res = createMockResponse();

		await handler(createMockRequest({ query: { search: 'crazy' } }), res);

		expect(res.status).toHaveBeenCalledWith(500);
	});
});
