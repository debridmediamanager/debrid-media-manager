import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MediaHeader from './MediaHeader';

type RelatedMediaProps = {
	imdbId: string;
	mediaType: 'movie' | 'show';
	[key: string]: unknown;
};

const { relatedMediaMock, posterMock } = vi.hoisted(() => ({
	relatedMediaMock: vi.fn((props: RelatedMediaProps) => (
		<div data-testid="related-media" data-media-type={props.mediaType} />
	)),
	posterMock: vi.fn((props: { imdbId: string; title: string }) => (
		<div data-testid="poster-fallback">{props.title}</div>
	)),
}));

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt, ...props }: any) => (
		<span role="img" aria-label={alt} data-testid="next-image-mock" {...props} />
	),
}));

vi.mock('@/components/RelatedMedia', () => ({
	__esModule: true,
	default: relatedMediaMock,
}));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: posterMock,
}));

type Props = ComponentProps<typeof MediaHeader>;

const createProps = (overrides: Partial<Props> = {}): Props => ({
	mediaType: 'movie',
	imdbId: 'tt1375666',
	title: 'Inception',
	year: '2010',
	seasonNum: undefined,
	description: 'A dream within a dream',
	poster: 'https://example.com/poster.jpg',
	backdrop: 'https://example.com/backdrop.jpg',
	imdbScore: 85,
	descLimit: 12,
	onDescToggle: vi.fn(),
	actionButtons: <div data-testid="actions">actions</div>,
	additionalInfo: <div data-testid="extra">extra</div>,
	...overrides,
});

describe('MediaHeader', () => {
	beforeEach(() => {
		relatedMediaMock.mockClear();
		posterMock.mockClear();
	});

	it('renders movie details with provided artwork and score formatting', async () => {
		const props = createProps();
		render(<MediaHeader {...props} />);

		expect(screen.getByRole('heading', { name: 'Inception (2010)' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Go Home/i })).toHaveAttribute('href', '/');
		const posterImage = screen.getByRole('img', { name: /Movie poster/i });
		expect(posterImage).toHaveAttribute('src', props.poster);
		expect(posterImage).toHaveClass('object-cover');
		expect(posterImage.parentElement).toHaveClass('aspect-[2/3]', 'shrink-0', 'self-start');

		const imdbLink = screen.getByRole('link', { name: /IMDB Score: 8.5/i });
		expect(imdbLink).toHaveAttribute('href', `https://www.imdb.com/title/${props.imdbId}/`);

		const descriptionNode = screen.getByText(
			(_, element) => element?.textContent?.startsWith('A dream with') ?? false
		);
		await userEvent.click(descriptionNode);
		expect(props.onDescToggle).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId('actions').parentElement).toHaveClass(
			'col-span-2',
			'sm:col-start-2'
		);

		const [relatedProps] = relatedMediaMock.mock.calls.at(-1)!;
		expect(relatedProps).toMatchObject({ imdbId: props.imdbId, mediaType: 'movie' });
	});

	it('falls back to the Poster component when no poster URL is provided', () => {
		const props = createProps({ poster: '', backdrop: undefined });
		render(<MediaHeader {...props} />);

		expect(screen.queryByRole('img', { name: /Movie poster/i })).toBeNull();
		expect(screen.getByTestId('poster-fallback')).toHaveTextContent(props.title);
		const [posterProps] = posterMock.mock.calls.at(-1)!;
		expect(posterProps).toMatchObject({ imdbId: props.imdbId, title: props.title });
	});

	it('labels seasons for shows and surfaces additional content', () => {
		const props = createProps({
			mediaType: 'tv',
			seasonNum: '3',
			year: undefined,
			description: 'A twisting mystery',
			imdbScore: 8,
			descLimit: 0,
			additionalInfo: <div data-testid="details">details</div>,
		});
		render(<MediaHeader {...props} />);

		expect(screen.getByRole('heading', { name: 'Inception - Season 3' })).toBeInTheDocument();
		expect(screen.getByRole('img', { name: /Show poster/i })).toBeInTheDocument();
		expect(screen.getByTestId('actions')).toBeInTheDocument();
		expect(screen.getByTestId('details')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /IMDB Score: 8$/i })).toBeInTheDocument();

		const [relatedProps] = relatedMediaMock.mock.calls.at(-1)!;
		expect(relatedProps).toMatchObject({ mediaType: 'show' });
	});
});
