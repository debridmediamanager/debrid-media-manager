import handler from '@/pages/api/zurg/register-api-key';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

const MOCK_SALT = 'test-dmmcast-salt-12345';

const buildBody = (overrides: Record<string, unknown> = {}) => ({
	...overrides,
});

const buildRequest = (bodyOverrides: Record<string, unknown> = {}) =>
	createMockRequest({
		method: 'POST',
		body: buildBody(bodyOverrides),
		headers: {
			authorization: MOCK_SALT,
		},
	});

describe('POST /api/zurg/register-api-key', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv, DMMCAST_SALT: MOCK_SALT };
		mockRepository.createZurgApiKey = vi.fn().mockResolvedValue('test-api-key-123');
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('requires authorization header', async () => {
		const req = createMockRequest({ method: 'POST', body: buildBody() });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing Authorization header' });
	});

	it('rejects invalid authorization', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody(),
			headers: {
				authorization: 'wrong-salt',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid authorization' });
	});

	it('refuses the .env.example placeholder salt as a credential', async () => {
		process.env = { ...originalEnv, DMMCAST_SALT: 'your-random-salt-here' };
		const req = createMockRequest({
			method: 'POST',
			body: buildBody(),
			headers: { authorization: 'your-random-salt-here' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(mockRepository.createZurgApiKey).not.toHaveBeenCalled();
	});

	it('rejects validForDays above maximum', async () => {
		const req = buildRequest({ validForDays: 366 });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'validForDays must be a number between 1 and 365',
		});
	});

	it('creates API key with default 30 days validity', async () => {
		const req = buildRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: 'test-api-key-123',
				expiresInDays: 30,
			})
		);

		expect(mockRepository.createZurgApiKey).toHaveBeenCalledWith(expect.any(Date));
	});

	it('creates API key with custom validity period', async () => {
		const req = buildRequest({ validForDays: 90 });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: 'test-api-key-123',
				expiresInDays: 90,
			})
		);

		expect(mockRepository.createZurgApiKey).toHaveBeenCalledWith(expect.any(Date));
	});
});
