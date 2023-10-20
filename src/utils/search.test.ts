import { expect, test } from 'vitest';
import { tokenizeString } from './search';

test('should tokenize the string correctly', () => {
	const testCases = [
		{ input: 'Hello, World!', expected: ['hello', 'world'] },
		{ input: 'Hello (World)', expected: ['hello', 'world'] },
		{ input: 'Hello[World]', expected: ['hello', 'world'] },
		{ input: 'Hello{World}', expected: ['hello', 'world'] },
		{ input: 'Hello+World', expected: ['hello', 'world'] },
		{ input: 'Hello\\World', expected: ['hello', 'world'] },
		{ input: 'Hello^World', expected: ['hello', 'world'] },
		{ input: 'Hello|World', expected: ['hello', 'world'] },
		{ input: 'Hello·World', expected: ['hello', 'world'] },
		{ input: 'Hello?World', expected: ['hello', 'world'] },
		{ input: 'Hello/World', expected: ['hello', 'world'] },
		{ input: 'Hello:World', expected: ['hello', 'world'] },
		{ input: 'Hello;World', expected: ['hello', 'world'] },
		{ input: '  Hello   World  ', expected: ['hello', 'world'] },
		{ input: 'Hello::World', expected: ['hello', 'world'] },
	];

	testCases.forEach(({ input, expected }) => {
		expect(tokenizeString(input)).toEqual(expected);
	});
});
