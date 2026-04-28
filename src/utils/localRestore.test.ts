import { afterEach, describe, expect, it, vi } from 'vitest';
import { localRestore } from './localRestore';

describe('localRestore', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('invokes the callback with parsed files from the selected JSON', async () => {
		vi.useFakeTimers();
		const changeHandlers: Array<() => Promise<void> | void> = [];
		const inputMock: any = {
			type: '',
			accept: '',
			onchange: null as ((e: Event) => void) | null,
			click: vi.fn(),
			addEventListener: vi.fn((event: string, handler: () => void) => {
				if (event === 'change') {
					changeHandlers.push(handler);
				}
			}),
		};
		vi.spyOn(document, 'createElement').mockReturnValue(inputMock);

		class MockFileReader {
			onload: ((evt: { target: { result: string } }) => void) | null = null;
			readAsText() {
				setTimeout(() => {
					this.onload?.({
						target: { result: JSON.stringify([{ hash: 'abc' }]) },
					});
				}, 0);
			}
		}

		vi.stubGlobal('FileReader', MockFileReader as any);

		const callback = vi.fn();
		await localRestore(callback);

		const fakeFile = {} as File;
		inputMock.onchange?.({ target: { files: [fakeFile] } } as any);
		await changeHandlers[0]!();
		vi.runAllTimers();
		await Promise.resolve();

		expect(callback).toHaveBeenCalledWith([{ hash: 'abc' }]);
		expect(inputMock.click).toHaveBeenCalled();
		vi.useRealTimers();
	});
});
