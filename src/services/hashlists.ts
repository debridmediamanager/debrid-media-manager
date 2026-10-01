import axios from 'axios';

interface CreateShortUrlResponse {
	shortUrl: string;
}

/**
 * Publishes a hash list, given as lz-string text, and answers the address of
 * its page. The list is stored as a file beside the page rather than inside
 * the page's iframe URL; see `hashlistSource`.
 */
export async function publishHashlist(data: string): Promise<string> {
	try {
		const response = await axios.post<CreateShortUrlResponse>(`api/hashlists`, { data });

		if (!response.data || !response.data.shortUrl) {
			throw new Error('Invalid response: missing shortUrl');
		}

		return response.data.shortUrl;
	} catch (error) {
		console.error('Error creating short URL:', error);
		throw error;
	}
}
