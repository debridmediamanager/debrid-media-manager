import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TrailerModal from './TrailerModal';

describe('TrailerModal', () => {
	it('should extract YouTube ID from full URL and render iframe', () => {
		const onClose = vi.fn();
		const trailerUrl = 'https://youtube.com/watch?v=PLl99DlL6b4';

		render(<TrailerModal trailerUrl={trailerUrl} onClose={onClose} title="Test Movie" />);

		const iframe = screen.getByTitle('Test Movie - Trailer');
		expect(iframe).toBeInTheDocument();
		expect(iframe).toHaveAttribute(
			'src',
			'https://www.youtube.com/embed/PLl99DlL6b4?autoplay=1'
		);
	});

	it('should call onClose when clicking close button', () => {
		const onClose = vi.fn();
		const trailerUrl = 'https://youtube.com/watch?v=PLl99DlL6b4';

		render(<TrailerModal trailerUrl={trailerUrl} onClose={onClose} />);

		const closeButton = screen.getByLabelText('Close trailer');
		fireEvent.click(closeButton);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('should call onClose when clicking overlay', () => {
		const onClose = vi.fn();
		const trailerUrl = 'https://youtube.com/watch?v=PLl99DlL6b4';

		const { container } = render(<TrailerModal trailerUrl={trailerUrl} onClose={onClose} />);

		const overlay = container.firstChild as HTMLElement;
		fireEvent.click(overlay);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('should not render if no valid YouTube ID', () => {
		const onClose = vi.fn();
		const trailerUrl = 'https://invalid-url.com';

		const { container } = render(<TrailerModal trailerUrl={trailerUrl} onClose={onClose} />);

		expect(container.firstChild).toBeNull();
	});

	it('should handle youtu.be short URLs', () => {
		const onClose = vi.fn();
		const trailerUrl = 'https://youtu.be/PLl99DlL6b4';

		render(<TrailerModal trailerUrl={trailerUrl} onClose={onClose} />);

		const iframe = screen.getByTitle('Trailer');
		expect(iframe).toHaveAttribute(
			'src',
			'https://www.youtube.com/embed/PLl99DlL6b4?autoplay=1'
		);
	});
});
