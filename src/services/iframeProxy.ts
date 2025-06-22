import axios, { AxiosInstance } from 'axios';

interface RequestData {
	messageId: string;
	url: string;
	method: string;
	headers?: Record<string, string>;
	body?: any;
}

interface ResponseData {
	messageId: string;
	response?: any;
	error?: any;
}

export class IframeProxy {
	private iframe: HTMLIFrameElement | null = null;
	private pendingRequests: Map<string, (data: any) => void>;
	private waitForReady: Promise<void>;
	private axiosClient: AxiosInstance;

	constructor() {
		this.axiosClient = axios.create();
		this.pendingRequests = new Map();
		this.waitForReady = new Promise((resolve) => {
			if (typeof window !== 'undefined' && typeof document !== 'undefined') {
				this.iframe = document.createElement('iframe');
				this.iframe.src = 'https://localhost.debridmediamanager.com';
				this.iframe.style.display = 'none';
				this.iframe.sandbox.add('allow-same-origin', 'allow-scripts');
				this.iframe.onload = () => {
					resolve();
				};
				document.body.appendChild(this.iframe);

				window.addEventListener('message', this.handleMessage.bind(this), false);
			} else {
				resolve();
			}
		});
	}

	// receive message from iframe
	private handleMessage(event: MessageEvent) {
		const iframeSrc = new URL(this.iframe?.src || '');
		const eventOrigin = new URL(event.origin);
		if (eventOrigin.origin !== iframeSrc.origin) {
			return;
		}

		const data: ResponseData = event.data;
		const resolve = this.pendingRequests.get(data.messageId);

		if (resolve) {
			this.pendingRequests.delete(data.messageId);
			if (data.error) {
				resolve(Promise.reject(data.error));
			} else {
				resolve(data.response);
			}
		}
	}

	public async sendRequest<T>(requestData: Omit<RequestData, 'messageId'>): Promise<T> {
		const requestHostname = new URL(requestData.url).hostname;
		if (
			typeof window === 'undefined' ||
			typeof document === 'undefined' ||
			!requestHostname.includes('real-debrid.com')
		) {
			// Server-side logic
			try {
				const response = await axios({
					method: requestData.method,
					url: requestData.url,
					headers: requestData.headers,
					data: requestData.body,
				});
				return response.data as T;
			} catch (error: any) {
				console.error('Error executing request:', error.message);
				throw error;
			}
		} else {
			// Client-side logic
			await this.waitForReady;
			return new Promise<T>((resolve, reject) => {
				if (!this.iframe || !this.iframe.contentWindow) {
					return reject(new Error('iframe is not initialized'));
				}

				const messageId = Math.random().toString(36);
				const fullRequestData: RequestData = { messageId, ...requestData };
				this.pendingRequests.set(messageId, (data: any) => resolve(data as T));

				this.iframe.contentWindow.postMessage(fullRequestData, this.iframe.src);
			});
		}
	}
}
