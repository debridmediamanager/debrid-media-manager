import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalProvider, getGlobalModalInstance } from './ModalContext';

const renderWithProvider = () => {
	render(
		<ModalProvider>
			<div>child</div>
		</ModalProvider>
	);
	return waitFor(() => {
		const instance = getGlobalModalInstance();
		if (!instance) {
			throw new Error('Modal instance not ready');
		}
		return instance;
	});
};

describe('ModalContext', () => {
	afterEach(() => {
		(window as any).closePopup = undefined;
	});

	it('fires confirm dialog and resolves when confirmed', async () => {
		const modal = await renderWithProvider();
		const promise = modal.fire({
			title: 'Delete item?',
			text: 'Are you sure?',
		});

		const confirmButton = await screen.findByRole('button', { name: 'OK' });
		expect((window as any).closePopup).toBeDefined();
		await userEvent.click(confirmButton);
		await expect(promise).resolves.toEqual({ isConfirmed: true });
		await waitFor(() => expect((window as any).closePopup).toBeUndefined());
	});

	it('renders loading modal when showLoading is called', async () => {
		const modal = await renderWithProvider();
		modal.showLoading();
		expect(await screen.findByText('Loading...')).toBeInTheDocument();
	});

	it('supports choice dialogs and deny flow', async () => {
		const modal = await renderWithProvider();
		const resultPromise = modal.fire({
			title: 'Pick an option',
			text: 'Choose wisely',
			showDenyButton: true,
			confirmButtonText: 'Accept',
			denyButtonText: 'Reject',
		});

		const denyButton = await screen.findByRole('button', { name: 'Reject' });
		await userEvent.click(denyButton);
		await expect(resultPromise).resolves.toEqual({ isConfirmed: false, isDenied: true });
	});

	it('opens custom html dialog and resolves with preConfirm result', async () => {
		const modal = await renderWithProvider();
		const resultPromise = modal.fire({
			title: 'Custom',
			html: '<p>Custom body</p>',
			preConfirm: () => Promise.resolve('done'),
		});

		const confirmButton = await screen.findByRole('button', { name: 'OK' });
		await userEvent.click(confirmButton);
		await expect(resultPromise).resolves.toEqual({ isConfirmed: true, value: 'done' });
	});

	it('keeps rejected custom input editable until validation succeeds', async () => {
		const modal = await renderWithProvider();
		const result = modal.fire({
			title: 'Add a torrent',
			html: '<input aria-label="Torrent source" />',
			preConfirm: () => {
				const input = document.querySelector<HTMLInputElement>(
					'input[aria-label="Torrent source"]'
				);
				return input?.value.startsWith('magnet:') ? input.value : false;
			},
		});
		const input = await screen.findByRole('textbox', { name: 'Torrent source' });
		await userEvent.type(input, 'invalid source');
		await userEvent.click(screen.getByRole('button', { name: 'OK' }));
		expect(input).toBeInTheDocument();
		expect(input).toHaveValue('invalid source');

		const source = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10';
		await userEvent.clear(input);
		await userEvent.type(input, source);
		await userEvent.click(screen.getByRole('button', { name: 'OK' }));
		await expect(result).resolves.toEqual({ isConfirmed: true, value: source });
		expect(input).not.toBeInTheDocument();
	});
});
