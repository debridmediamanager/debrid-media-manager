import { createMockRequest } from '@/test/utils/api';
import { describe, expect, it } from 'vitest';
import { getClientIpFromRequest } from './clientIp';

describe('getClientIpFromRequest', () => {
	it('returns cf-connecting-ip when present', () => {
		const req = createMockRequest({
			headers: { 'cf-connecting-ip': '1.2.3.4' },
		});
		expect(getClientIpFromRequest(req)).toBe('1.2.3.4');
	});

	it('returns x-real-ip when cf-connecting-ip is absent', () => {
		const req = createMockRequest({
			headers: { 'x-real-ip': '5.6.7.8' },
		});
		expect(getClientIpFromRequest(req)).toBe('5.6.7.8');
	});

	it('returns first IP from x-forwarded-for when others are absent', () => {
		const req = createMockRequest({
			headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3' },
		});
		expect(getClientIpFromRequest(req)).toBe('10.0.0.1');
	});

	it('returns socket remoteAddress as fallback', () => {
		const req = createMockRequest();
		(req as any).socket = { remoteAddress: '127.0.0.1' };
		expect(getClientIpFromRequest(req)).toBe('127.0.0.1');
	});

	it('returns empty string when no IP found', () => {
		const req = createMockRequest();
		(req as any).socket = { remoteAddress: undefined };
		expect(getClientIpFromRequest(req)).toBe('');
	});

	it('trims whitespace from cf-connecting-ip', () => {
		const req = createMockRequest({
			headers: { 'cf-connecting-ip': '  1.2.3.4  ' },
		});
		expect(getClientIpFromRequest(req)).toBe('1.2.3.4');
	});

	it('trims whitespace from x-real-ip', () => {
		const req = createMockRequest({
			headers: { 'x-real-ip': '  5.6.7.8  ' },
		});
		expect(getClientIpFromRequest(req)).toBe('5.6.7.8');
	});

	it('trims whitespace from x-forwarded-for entries', () => {
		const req = createMockRequest({
			headers: { 'x-forwarded-for': '  10.0.0.1 , 10.0.0.2' },
		});
		expect(getClientIpFromRequest(req)).toBe('10.0.0.1');
	});

	it('prioritizes cf-connecting-ip over x-real-ip', () => {
		const req = createMockRequest({
			headers: {
				'cf-connecting-ip': '1.1.1.1',
				'x-real-ip': '2.2.2.2',
			},
		});
		expect(getClientIpFromRequest(req)).toBe('1.1.1.1');
	});

	it('prioritizes x-real-ip over x-forwarded-for', () => {
		const req = createMockRequest({
			headers: {
				'x-real-ip': '2.2.2.2',
				'x-forwarded-for': '3.3.3.3',
			},
		});
		expect(getClientIpFromRequest(req)).toBe('2.2.2.2');
	});

	it('prioritizes cf-connecting-ip over all others', () => {
		const req = createMockRequest({
			headers: {
				'cf-connecting-ip': '1.1.1.1',
				'x-real-ip': '2.2.2.2',
				'x-forwarded-for': '3.3.3.3',
			},
		});
		(req as any).socket = { remoteAddress: '4.4.4.4' };
		expect(getClientIpFromRequest(req)).toBe('1.1.1.1');
	});

	it('skips empty cf-connecting-ip and falls through', () => {
		const req = createMockRequest({
			headers: {
				'cf-connecting-ip': '   ',
				'x-real-ip': '2.2.2.2',
			},
		});
		expect(getClientIpFromRequest(req)).toBe('2.2.2.2');
	});
});
