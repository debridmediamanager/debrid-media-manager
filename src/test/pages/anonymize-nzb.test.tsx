import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveBlobMock = vi.fn();

vi.mock('@/utils/nzbDownload', () => ({
	__esModule: true,
	saveBlob: (blob: Blob, name: string) => saveBlobMock(blob, name),
}));

vi.mock('@/components/Logo', () => ({
	__esModule: true,
	Logo: () => <div data-testid="logo" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import AnonymizeNzbPage from '@/pages/anonymize-nzb';

/**
 * Shaped on a real DrunkenSlug grab (2026-09-01), plus the head fields a
 * passworded release carries: the `tag` is the per-download token this page
 * exists to take off, the rest belong to the release.
 */
const TAGGED = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
	<head>
		<meta type="tag">0a624180.27889905291</meta>
		<meta type="name">Some.Release.S01E01.1080p</meta>
		<meta type="password">houseofusenet</meta>
	</head>
	<file poster="JWPKEi710Ds54]CxtEUoEzw0dz@9LbPyEir.Kul" date="1788097954" subject="[1/1] - &quot;My.File.mkv&quot; yEnc (1/2) 33571884">
		<groups>
			<group>alt.binaries.multimedia.alias</group>
		</groups>
		<segments>
			<segment bytes="739000" number="1">HsRvHpNtAiFhQkUaIuIvNeTo-1788097954246@nyuu</segment>
			<segment bytes="512000" number="2">ImBxLeYrJeKvNxFlWaFwQmUe-1788097954310@nyuu</segment>
		</segments>
	</file>
</nzb>`;

/** A one-segment "downloaded by" article beside the real file. */
const PLANTED = `<nzb>
	<file subject="&quot;downloaded-by-user-4417.txt&quot; yEnc (1/1)"><groups><group>a.b.c</group></groups><segments>
		<segment bytes="312" number="1">planted@news</segment>
	</segments></file>
	<file subject="&quot;real.mkv&quot; yEnc (1/1)"><groups><group>a.b.c</group></groups><segments>
		<segment bytes="739000" number="1">real@news</segment>
	</segments></file>
</nzb>`;

// jsdom's File has no text(), which every browser the page runs in does.
const nzbFile = (name: string, body: string) =>
	Object.assign(new File([body], name, { type: 'application/x-nzb' }), {
		text: async () => body,
	});

function readBlob(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsText(blob);
	});
}

function choose(...files: File[]) {
	fireEvent.change(screen.getByLabelText('Choose NZB files'), { target: { files } });
}

/** What the last Download click handed to the browser. */
async function lastSaved(): Promise<{ name: string; xml: string }> {
	const [blob, name] = saveBlobMock.mock.calls.at(-1) as [Blob, string];
	return { name, xml: await readBlob(blob) };
}

const fetchSpy = vi.fn();
const beaconSpy = vi.fn();

beforeEach(() => {
	saveBlobMock.mockReset();
	fetchSpy.mockReset();
	beaconSpy.mockReset();
	vi.stubGlobal('fetch', fetchSpy);
	Object.defineProperty(navigator, 'sendBeacon', {
		value: beaconSpy,
		configurable: true,
		writable: true,
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Anonymize NZB page', () => {
	// Said before a file is chosen, not after: it is the reason to trust the page
	// with a file that still carries the tag.
	it('says up front that it runs only in the browser', () => {
		render(<AnonymizeNzbPage />);

		const notice = screen.getByTestId('client-side-notice');
		expect(within(notice).getByText('Client-side only')).toBeTruthy();
		expect(within(notice).getByText(/Nothing is uploaded, not even to DMM/)).toBeTruthy();
		expect(screen.queryByTestId('nzb-result')).toBeNull();
	});

	it('takes the per-download tag off and names it', async () => {
		render(<AnonymizeNzbPage />);
		choose(nzbFile('Some.Release.S01E01.1080p.nzb', TAGGED));

		const result = await screen.findByTestId('nzb-result');
		expect(
			within(result).getByText(/<meta type="tag"> \(0a624180\.27889905291\)/)
		).toBeTruthy();
		expect(within(result).getByText('DOCTYPE')).toBeTruthy();
		expect(within(result).getByText('post dates')).toBeTruthy();

		fireEvent.click(within(result).getByRole('button', { name: /Download/ }));
		const saved = await lastSaved();

		expect(saved.xml).not.toContain('0a624180.27889905291');
		expect(saved.xml).not.toContain('poster=');
		expect(saved.xml).not.toContain('date=');
		expect(saved.xml).not.toMatch(/DOCTYPE/i);
		expect(saved.xml).toContain('<meta type="name">Some.Release.S01E01.1080p</meta>');
		expect(saved.xml).toContain('HsRvHpNtAiFhQkUaIuIvNeTo-1788097954246@nyuu');
		expect(saved.xml).toContain('ImBxLeYrJeKvNxFlWaFwQmUe-1788097954310@nyuu');
		expect(saved.name).toBe('Some.Release.S01E01.1080p.nzb');
	});

	// The promise the page makes: a file still carrying its tag never reaches a
	// server, DMM's included.
	it('cleans without sending the file anywhere', async () => {
		render(<AnonymizeNzbPage />);
		choose(nzbFile('a.nzb', TAGGED));

		fireEvent.click(await screen.findByRole('button', { name: /Download/ }));
		await lastSaved();

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(beaconSpy).not.toHaveBeenCalled();
	});

	it('keeps the archive password by default and re-cleans loaded files when told not to', async () => {
		render(<AnonymizeNzbPage />);
		choose(nzbFile('a.nzb', TAGGED));

		fireEvent.click(await screen.findByRole('button', { name: /Download/ }));
		expect((await lastSaved()).xml).toContain('<meta type="password">houseofusenet</meta>');

		fireEvent.click(screen.getByRole('checkbox', { name: /Keep the archive password/ }));
		fireEvent.click(screen.getByRole('button', { name: /Download/ }));
		expect((await lastSaved()).xml).not.toContain('houseofusenet');
	});

	it('says so when a file is not an NZB, and offers nothing to download', async () => {
		render(<AnonymizeNzbPage />);
		choose(nzbFile('login.html', '<html><body>session expired</body></html>'));

		const result = await screen.findByTestId('nzb-result');
		expect(within(result).getByText(/not an NZB/)).toBeTruthy();
		expect(within(result).queryByRole('button', { name: /Download/ })).toBeNull();
	});

	// Kept, never dropped — a release can carry a real tiny nfo — but it is the
	// one thing a rebuild cannot rule out, so it has to be put in front of
	// whoever is about to publish the file.
	it('warns about a tiny file that could be a planted watermark', async () => {
		render(<AnonymizeNzbPage />);
		choose(nzbFile('a.nzb', PLANTED));

		const result = await screen.findByTestId('nzb-result');
		expect(within(result).getByText(/downloaded-by-user-4417\.txt/)).toBeTruthy();
		expect(within(result).getByText(/1 tiny file left in/)).toBeTruthy();
	});

	it('tells an already clean file apart from one that had something removed', async () => {
		render(<AnonymizeNzbPage />);
		choose(nzbFile('a.nzb', TAGGED));
		const tagged = await screen.findByTestId('nzb-result');
		fireEvent.click(within(tagged).getByRole('button', { name: /Download/ }));
		const cleaned = (await lastSaved()).xml;

		fireEvent.click(within(tagged).getByRole('button', { name: 'Remove a.nzb' }));
		choose(nzbFile('b.nzb', cleaned));

		const again = await screen.findByTestId('nzb-result');
		expect(within(again).getByText('b.nzb')).toBeTruthy();
		expect(within(again).getByText(/Nothing identifying was on it/)).toBeTruthy();
		expect(within(again).queryByText('Taken off')).toBeNull();
	});

	it('accepts a dropped file', async () => {
		render(<AnonymizeNzbPage />);
		fireEvent.drop(screen.getByTestId('nzb-dropzone'), {
			dataTransfer: { files: [nzbFile('dropped.nzb', TAGGED)] },
		});

		expect(await screen.findByText('dropped.nzb')).toBeTruthy();
	});

	it('downloads every cleanable file at once and skips the broken one', async () => {
		render(<AnonymizeNzbPage />);
		choose(
			nzbFile('one.nzb', TAGGED),
			nzbFile('broken.nzb', '<nzb></nzb>'),
			nzbFile('two.nzb', PLANTED)
		);

		await waitFor(() => expect(screen.getAllByTestId('nzb-result')).toHaveLength(3));
		fireEvent.click(screen.getByRole('button', { name: /Download all 2/ }));

		expect(saveBlobMock.mock.calls.map(([, name]) => name)).toEqual(['one.nzb', 'two.nzb']);
	});
});
