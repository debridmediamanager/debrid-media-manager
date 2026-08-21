import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DownloadAlbumModal from './DownloadAlbumModal';

const makeTrack = (id: string) => ({
	id,
	hash: 'abc123',
	fileId: 1,
	link: `https://example.com/link-${id}`,
	path: `/music/${id}.flac`,
	bytes: 30 * 1024 * 1024,
	trackNumber: 1,
	filename: `${id}.flac`,
});

const makeAlbum = (trackCount: number) => ({
	hash: 'abc123',
	mbid: 'mbid-1',
	artist: 'Test Artist',
	album: 'Test Album',
	year: 2023,
	coverUrl: null as string | null,
	tracks: Array.from({ length: trackCount }, (_, i) => makeTrack(`t${i + 1}`)),
	totalBytes: trackCount * 30 * 1024 * 1024,
	trackCount,
});

const mockOnConfirm = vi.fn();
const mockOnClose = vi.fn();

const renderModal = (trackCount = 2) =>
	render(
		<DownloadAlbumModal
			album={makeAlbum(trackCount)}
			onConfirm={mockOnConfirm}
			onClose={mockOnClose}
		/>
	);

describe('DownloadAlbumModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the dialog with the album summary', () => {
		renderModal(2);
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Download this album?')).toBeInTheDocument();
		expect(screen.getByText(/Test Album/)).toBeInTheDocument();
		expect(screen.getByText(/2 files/)).toBeInTheDocument();
		expect(screen.getByText(/60\.0 MB/)).toBeInTheDocument();
	});

	it('warns about the browser multiple-download prompt', () => {
		renderModal();
		expect(screen.getByText('download multiple files')).toBeInTheDocument();
		expect(screen.getByText('Allow')).toBeInTheDocument();
	});

	it('labels the confirm button with the track count', () => {
		renderModal(12);
		expect(screen.getByRole('button', { name: 'Download 12 tracks' })).toBeInTheDocument();
	});

	it('uses singular wording for a one-track album', () => {
		renderModal(1);
		expect(screen.getByRole('button', { name: 'Download 1 track' })).toBeInTheDocument();
		expect(screen.getByText(/1 file /)).toBeInTheDocument();
	});

	it('calls onConfirm when the download button is clicked', () => {
		renderModal();
		fireEvent.click(screen.getByRole('button', { name: 'Download 2 tracks' }));
		expect(mockOnConfirm).toHaveBeenCalledTimes(1);
		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it('calls onClose when Cancel is clicked', () => {
		renderModal();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(mockOnClose).toHaveBeenCalledTimes(1);
		expect(mockOnConfirm).not.toHaveBeenCalled();
	});

	it('calls onClose when the close icon is clicked', () => {
		renderModal();
		fireEvent.click(screen.getByRole('button', { name: 'Close download dialog' }));
		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it('calls onClose when the backdrop is clicked', () => {
		renderModal();
		fireEvent.click(screen.getByRole('dialog'));
		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it('does not call onClose when the dialog body is clicked', () => {
		renderModal();
		fireEvent.click(screen.getByText('Download this album?'));
		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it('calls onClose on Escape', () => {
		renderModal();
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it('removes the Escape listener on unmount', () => {
		const { unmount } = renderModal();
		unmount();
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(mockOnClose).not.toHaveBeenCalled();
	});
});
