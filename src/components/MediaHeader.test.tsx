import caskInfo from '@/test/fixtures/metadata/api-info-movie-tt2249097-the-cask-of-amontillado.json';
import airwolfInfo from '@/test/fixtures/metadata/api-info-show-tt0166030-airwolf.json';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MediaHeader, { FALLBACK_BACKDROP } from './MediaHeader';

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

// A real <img>, so an error event reaches the component's handler as it does in
// a browser; React listens for `error` on media elements only.
vi.mock('next/image', () => ({
	__esModule: true,
	// eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
	default: ({ fill: _fill, ...props }: any) => <img data-testid="next-image-mock" {...props} />,
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

/** The header container's style attribute, as React serializes it. */
const headerStyle = (element: ReactElement) => {
	const markup = renderToStaticMarkup(element);
	const header = markup.match(/<div class="grid [^"]*"(?: style="([^"]*)")?/);
	expect(header).not.toBeNull();
	return header![1] ?? '';
};

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

	// Fizzy #200. These are what production answered on 2026-10-03, and both
	// poster URLs answer 404: Cinemeta's metahub URL for Airwolf (tt0166030) and
	// OMDb's m.media-amazon.com URL for The Cask of Amontillado (tt2249097). In a
	// 400 show + 400 movie sample, 8 show and 13 movie posters were dead like
	// this, and the header drew a broken-image icon for each. The Poster
	// component has a chain for exactly this; the header only used it for an
	// empty URL.
	it.each([
		['tv' as const, 'tt0166030', airwolfInfo],
		['movie' as const, 'tt2249097', caskInfo],
	])(
		'falls back to the Poster component when the %s poster for %s fails to load',
		(mediaType, imdbId, info) => {
			render(
				<MediaHeader
					{...createProps({
						mediaType,
						imdbId,
						title: info.title,
						poster: info.poster,
						backdrop: info.backdrop,
					})}
				/>
			);

			const img = screen.getByRole('img', { name: /poster/i });
			expect(img).toHaveAttribute('src', info.poster);
			fireEvent.error(img);

			expect(screen.queryByRole('img', { name: /poster/i })).toBeNull();
			expect(screen.getByTestId('poster-fallback')).toHaveTextContent(info.title);
			const [posterProps] = posterMock.mock.calls.at(-1)!;
			expect(posterProps).toMatchObject({ imdbId, title: info.title });
		}
	);

	// The season and movie pages keep the header mounted when they move to
	// another title, so a URL that failed must not stop the next one being tried.
	it('tries a new poster URL after an earlier one failed', () => {
		const props = createProps({ poster: caskInfo.poster });
		const { rerender } = render(<MediaHeader {...props} />);
		fireEvent.error(screen.getByRole('img', { name: /Movie poster/i }));
		expect(screen.getByTestId('poster-fallback')).toBeInTheDocument();

		rerender(<MediaHeader {...props} poster="https://example.com/next-title.jpg" />);

		expect(screen.getByRole('img', { name: /Movie poster/i })).toHaveAttribute(
			'src',
			'https://example.com/next-title.jpg'
		);
		expect(screen.queryByTestId('poster-fallback')).toBeNull();
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

	// Fizzy #37. /api/info/show and /api/info/movie answer an empty backdrop when
	// no provider has art; The Accursed (tt4182368) is one. The header drew
	// nothing then, so the API used to fill the gap with a stock photo.
	//
	// These read the style attribute React writes. jsdom's CSSOM cannot parse a
	// multi-layer background and reads it back as '', which a browser does not.
	it('draws its own backdrop when the title has none', () => {
		const style = headerStyle(
			<MediaHeader
				{...createProps({ mediaType: 'tv', title: 'The Accursed', backdrop: '' })}
			/>
		);

		expect(style).toMatch(/^background-image:linear-gradient\(to bottom,/);
		expect(style).toContain(FALLBACK_BACKDROP);
		expect(style).not.toContain('url(');
	});

	// Cinemeta hands out a metahub URL for every title. This one is what
	// production served for Airwolf (tt0166030) on 2026-10-03, and it answers 404,
	// as 69 of the 83 metahub backdrops in a 400 show + 400 movie sample did. A
	// background layer that fails to load is transparent, so the header's own
	// backdrop has to sit beneath it rather than replace it.
	it('keeps its own backdrop beneath a backdrop URL, for when that URL is dead', () => {
		const deadUrl = 'https://images.metahub.space/background/medium/tt0166030/img';
		const style = headerStyle(
			<MediaHeader
				{...createProps({ mediaType: 'tv', title: 'Airwolf', backdrop: deadUrl })}
			/>
		);

		const backdropLayer = style.match(/url\((?:&quot;)?([^)&]*)(?:&quot;)?\)/);
		expect(backdropLayer?.[1]).toBe(deadUrl);
		// The first layer listed is drawn on top, so what shows when the URL
		// fails is whatever is listed after it.
		const beneath = style.slice(backdropLayer!.index! + backdropLayer![0].length);
		expect(beneath).toContain('gradient');
		expect(beneath).toContain(FALLBACK_BACKDROP);
	});

	it('wraps title actions when a narrow header cannot fit them on one line', () => {
		render(
			<MediaHeader
				{...createProps({
					title: 'The Shawshank Redemption',
					year: '1994',
					trailer: 'https://example.com/trailer',
				})}
			/>
		);

		const title = screen.getByRole('heading', { name: 'The Shawshank Redemption (1994)' });
		expect(title).toHaveClass('min-w-0');
		expect(title.parentElement).toHaveClass('flex-wrap');
	});
});
