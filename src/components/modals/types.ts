/** A title's poster shown above a dialog's content. */
export interface DialogPoster {
	imdbId: string;
	title: string;
}

export interface FireOptions {
	title?: string;
	text?: string;
	html?: string;
	icon?: 'warning' | 'error' | 'success' | 'info' | 'question';
	confirmButtonText?: string;
	confirmButtonColor?: string;
	cancelButtonColor?: string;
	denyButtonColor?: string;
	denyButtonText?: string;
	cancelButtonText?: string;
	showCancelButton?: boolean;
	showDenyButton?: boolean;
	showConfirmButton?: boolean;
	input?: 'text';
	inputPlaceholder?: string;
	inputAttributes?: any;
	preConfirm?: () => Promise<any> | any;
	background?: string;
	color?: string;
	customClass?: any;
	willOpen?: () => void;
	didOpen?: () => void;
	allowOutsideClick?: boolean;
	allowEscapeKey?: boolean;
	width?: string;
	showCloseButton?: boolean;
	inputAutoFocus?: boolean;
	poster?: DialogPoster;
}

export interface ModalResult {
	isConfirmed: boolean;
	isDenied?: boolean;
	isDismissed?: boolean;
	value?: any;
	dismiss?: string;
}
