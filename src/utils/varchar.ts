/**
 * The longest value a Prisma `String` column holds on MySQL.
 *
 * A `String` field with no `@db` type is `varchar(191)`, the most a utf8mb4
 * column can index under InnoDB's old 767-byte key limit. utf8mb4 counts it in
 * characters, so 191 code points fit whatever bytes they take.
 */
export const VARCHAR_LENGTH = 191;

/**
 * `value` cut to fit a `varchar(length)` column, counted the way MySQL counts it.
 *
 * In code points, not UTF-16 units: `slice` would count an emoji as two and
 * could cut one in half, leaving a lone surrogate the driver cannot encode.
 */
export function clipToVarchar(value: string, length: number = VARCHAR_LENGTH): string {
	if (value.length <= length) return value;
	const chars = Array.from(value);
	return chars.length <= length ? value : chars.slice(0, length).join('');
}
