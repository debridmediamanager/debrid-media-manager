// The value .env.example ships. It is public, so a server still using it hands
// out guessable Cast ids and lets anyone call /api/zurg/register-api-key.
export const PLACEHOLDER_CAST_SALT = 'your-random-salt-here';

export function castSalt(): string {
	const salt = process.env.DMMCAST_SALT;
	if (!salt) throw new Error('DMMCAST_SALT environment variable is not set');
	if (salt === PLACEHOLDER_CAST_SALT)
		throw new Error(
			'DMMCAST_SALT is still the .env.example placeholder; set it to a long random string (openssl rand -hex 32)'
		);
	return salt;
}
