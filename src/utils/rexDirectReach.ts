/**
 * Whether the rex server `machineIdentifier` answers at `http://[ip]:port/identity`.
 *
 * rex-direct points a server's public name at the IP its register request came from, so
 * nobody can aim a name under our domain at someone else's host. DMM is reached over IPv4
 * only, so a server's IPv6 address can only be what it says it is; connecting back to it
 * and finding the same server there is the proof instead. `/identity` is open on every rex
 * and PMS and names its machineIdentifier.
 */
const TIMEOUT_MS = 5000;
const MAX_BYTES = 64 * 1024;

export async function answersAsMachine(
	ip: string,
	port: number,
	machineIdentifier: string
): Promise<boolean> {
	try {
		const res = await fetch(`http://[${ip}]:${port}/identity`, {
			redirect: 'manual',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { Accept: 'application/xml' },
		});
		if (!res.ok) return false;
		const text = (await res.text()).slice(0, MAX_BYTES);
		const found = /machineIdentifier="([0-9a-f]+)"/i.exec(text)?.[1];
		return !!found && found.toLowerCase() === machineIdentifier.toLowerCase();
	} catch {
		return false;
	}
}
