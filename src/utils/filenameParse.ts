import { filenameParse as parse } from '@ctrl/video-filename-parser';

// The parser reads a frame rate as an absolute episode (`...-4k-60fps` became E60), so drop
// its number; the bare `fps` keeps the token, which moving the rest around would not.
const FRAME_RATE = /\b\d{2,3}(?:[.,]\d{1,3})?\s?(?=fps\b)/gi;

/** `@ctrl/video-filename-parser`'s filenameParse, with frame rates hidden from its episode patterns. */
export const filenameParse: typeof parse = (name, isTv) =>
	parse(isTv ? name.replace(FRAME_RATE, '') : name, isTv);
