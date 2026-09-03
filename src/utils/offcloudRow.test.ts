import { describe, expect, it } from 'vitest';
import { OC_ID_PREFIX, isOffcloudRowId, parseOffcloudRowId, toOffcloudRowId } from './offcloudRow';

describe('offcloudRow', () => {
	it('builds a row id from a request id and reads it back', () => {
		const rowId = toOffcloudRowId('68b7f0c1e4b0a1');
		expect(rowId).toBe('oc:68b7f0c1e4b0a1');
		expect(isOffcloudRowId(rowId)).toBe(true);
		expect(parseOffcloudRowId(rowId)).toBe('68b7f0c1e4b0a1');
	});

	it('keeps the three-character prefix other services slice by position', () => {
		// `fetchHashAndProgress` and friends read a service off `id.substring(0, 3)`
		expect(OC_ID_PREFIX).toHaveLength(3);
		expect(toOffcloudRowId('x').substring(0, 3)).toBe(OC_ID_PREFIX);
	});

	it('refuses rows belonging to another service', () => {
		expect(isOffcloudRowId('pm:t123')).toBe(false);
		expect(parseOffcloudRowId('pm:t123')).toBeNull();
		expect(parseOffcloudRowId('rd:abc')).toBeNull();
	});

	it('refuses a prefix with no request id behind it', () => {
		// An empty id would reach `GET /api/cloud/remove/` - a destructive call
		// against an unknown item.
		expect(parseOffcloudRowId('oc:')).toBeNull();
	});
});
