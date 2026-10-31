import { AlertTriangle, CheckCircle, HelpCircle, Info, Loader2, X, XCircle } from 'lucide-react';
import React, {
	createContext,
	ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import Poster from '../poster';
import type { FireOptions, ModalResult } from './types';

interface ModalContextType {
	fire: (options: FireOptions) => Promise<ModalResult>;
	close: () => void;
	showLoading: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

const useModal = () => {
	const context = useContext(ModalContext);
	if (!context) {
		throw new Error('useModal must be used within a ModalProvider');
	}
	return context;
};

let globalModalInstance: ModalContextType | null = null;

const setGlobalModalInstance = (instance: ModalContextType) => {
	globalModalInstance = instance;
};

export const getGlobalModalInstance = () => {
	if (!globalModalInstance) {
		console.warn('Modal instance not initialized. Make sure ModalProvider is mounted.');
	}
	return globalModalInstance;
};

interface ModalState {
	type: 'confirm' | 'choice' | 'input' | 'custom' | 'loading' | null;
	options: any;
	resolve: (value: any) => void;
}

export const ModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	const [modalState, setModalState] = useState<ModalState>({
		type: null,
		options: {},
		resolve: () => {},
	});

	const close = useCallback(() => {
		setModalState((prevState) => {
			if (prevState.resolve) {
				prevState.resolve({ isConfirmed: false, isDismissed: true });
			}
			return {
				type: null,
				options: {},
				resolve: () => {},
			};
		});
	}, []);

	const fire = useCallback(
		(options: FireOptions): Promise<ModalResult> => {
			return new Promise((resolve) => {
				if (options.willOpen) {
					options.willOpen();
				}

				// An html body always gets the html dialog, third button or not:
				// the choice dialog has no body, so routing by showDenyButton first
				// dropped the profile from the service card's popup.
				let type: ModalState['type'] = 'confirm';
				if (options.input === 'text') {
					type = 'input';
				} else if (options.html && !options.text) {
					type = 'custom';
				} else if (options.showDenyButton) {
					type = 'choice';
				}

				if (typeof window !== 'undefined') {
					(window as any).closePopup = close;
				}

				setModalState({
					type,
					options,
					resolve,
				});
			});
		},
		[close]
	);

	const showLoading = useCallback(() => {
		setModalState({
			type: 'loading',
			options: {},
			resolve: () => {},
		});
	}, []);

	const closeModal = (result: any) => {
		modalState.resolve(result);
		setModalState({
			type: null,
			options: {},
			resolve: () => {},
		});
	};

	const contextValue = useMemo(
		() => ({
			fire,
			close,
			showLoading,
		}),
		[fire, close, showLoading]
	);

	useEffect(() => {
		setGlobalModalInstance(contextValue);
		return () => {
			globalModalInstance = null;
		};
	}, [contextValue]);

	// Set up global close function when modal is opened
	useEffect(() => {
		if (modalState.type && typeof window !== 'undefined') {
			(window as any).closePopup = close;
			return () => {
				if ((window as any).closePopup) {
					delete (window as any).closePopup;
				}
			};
		}
	}, [modalState.type, close]);

	return (
		<ModalContext.Provider value={contextValue}>
			{children}
			{modalState.type === 'loading' && <LoadingModal />}
			{modalState.type === 'confirm' && (
				<ConfirmDialog {...modalState.options} onClose={closeModal} />
			)}
			{modalState.type === 'choice' && (
				<ChoiceDialog {...modalState.options} onClose={closeModal} />
			)}
			{modalState.type === 'input' && (
				<InputDialog {...modalState.options} onClose={closeModal} />
			)}
			{modalState.type === 'custom' && (
				<CustomHtmlDialog {...modalState.options} onClose={closeModal} />
			)}
		</ModalContext.Provider>
	);
};

interface BaseModalProps {
	onClose: (result: ModalResult) => void;
}

const LoadingModal: React.FC = () => (
	<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div className="rounded-lg bg-gray-900 p-6 shadow-xl">
			<div className="sibling-space-x-3 flex items-center">
				<Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
				<span className="text-gray-100">Loading...</span>
			</div>
		</div>
	</div>
);

const ConfirmDialog: React.FC<FireOptions & BaseModalProps> = ({
	title,
	text,
	icon = 'warning',
	confirmButtonText = 'OK',
	showCancelButton = true,
	allowOutsideClick = true,
	allowEscapeKey = true,
	onClose,
}) => {
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && allowEscapeKey) {
				onClose({ isConfirmed: false, isDismissed: true, dismiss: 'esc' });
			}
		};
		window.addEventListener('keydown', handleEscape);
		return () => window.removeEventListener('keydown', handleEscape);
	}, [onClose, allowEscapeKey]);

	const handleBackdropClick = () => {
		if (allowOutsideClick) {
			onClose({ isConfirmed: false, isDismissed: true, dismiss: 'backdrop' });
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={handleBackdropClick}
		>
			<div
				className="w-full max-w-md rounded-lg bg-gray-900 p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				{icon && (
					<div className="mb-4 flex items-center justify-center">
						{icon === 'warning' && (
							<AlertTriangle className="h-12 w-12 text-yellow-500" />
						)}
						{icon === 'error' && <XCircle className="h-12 w-12 text-red-500" />}
						{icon === 'success' && <CheckCircle className="h-12 w-12 text-green-500" />}
						{icon === 'info' && <Info className="h-12 w-12 text-blue-500" />}
						{icon === 'question' && <HelpCircle className="h-12 w-12 text-gray-400" />}
					</div>
				)}
				{title && (
					<h2 className="mb-2 text-center text-xl font-bold text-gray-100">{title}</h2>
				)}
				{text && <p className="mb-6 text-center text-gray-300">{text}</p>}
				<div className="sibling-space-x-3 flex justify-center">
					<button
						onClick={() => onClose({ isConfirmed: true })}
						className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-800 focus:ring-2 focus:ring-cyan-500 focus:outline-hidden"
					>
						{confirmButtonText}
					</button>
					{showCancelButton && (
						<button
							onClick={() =>
								onClose({
									isConfirmed: false,
									isDismissed: true,
									dismiss: 'cancel',
								})
							}
							className="rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600 focus:ring-2 focus:ring-gray-500 focus:outline-hidden"
						>
							Cancel
						</button>
					)}
				</div>
			</div>
		</div>
	);
};

const ChoiceDialog: React.FC<FireOptions & BaseModalProps> = ({
	title,
	text,
	icon = 'question',
	confirmButtonText,
	denyButtonText,
	cancelButtonText = 'Cancel',
	showCancelButton = true,
	allowOutsideClick = true,
	allowEscapeKey = true,
	onClose,
}) => {
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && allowEscapeKey) {
				onClose({ isConfirmed: false, isDenied: false, isDismissed: true, dismiss: 'esc' });
			}
		};
		window.addEventListener('keydown', handleEscape);
		return () => window.removeEventListener('keydown', handleEscape);
	}, [onClose, allowEscapeKey]);

	const handleBackdropClick = () => {
		if (allowOutsideClick) {
			onClose({
				isConfirmed: false,
				isDenied: false,
				isDismissed: true,
				dismiss: 'backdrop',
			});
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={handleBackdropClick}
		>
			<div
				className="w-full max-w-md rounded-lg bg-gray-900 p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				{icon && (
					<div className="mb-4 flex items-center justify-center">
						{icon === 'warning' && (
							<AlertTriangle className="h-12 w-12 text-yellow-500" />
						)}
						{icon === 'error' && <XCircle className="h-12 w-12 text-red-500" />}
						{icon === 'success' && <CheckCircle className="h-12 w-12 text-green-500" />}
						{icon === 'info' && <Info className="h-12 w-12 text-blue-500" />}
						{icon === 'question' && <HelpCircle className="h-12 w-12 text-gray-400" />}
					</div>
				)}
				{title && (
					<h2 className="mb-2 text-center text-xl font-bold text-gray-100">{title}</h2>
				)}
				{text && <p className="mb-6 text-center text-gray-300">{text}</p>}
				<div className="sibling-space-x-3 flex justify-center">
					<button
						onClick={() => onClose({ isConfirmed: true, isDenied: false })}
						className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-800 focus:ring-2 focus:ring-cyan-500 focus:outline-hidden"
					>
						{confirmButtonText}
					</button>
					<button
						onClick={() => onClose({ isConfirmed: false, isDenied: true })}
						className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
					>
						{denyButtonText}
					</button>
					{showCancelButton && (
						<button
							onClick={() =>
								onClose({ isConfirmed: false, isDenied: false, isDismissed: true })
							}
							className="rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600 focus:ring-2 focus:ring-gray-500 focus:outline-hidden"
						>
							{cancelButtonText}
						</button>
					)}
				</div>
			</div>
		</div>
	);
};

const InputDialog: React.FC<FireOptions & BaseModalProps> = ({
	title,
	inputPlaceholder = 'Enter a value',
	showCancelButton = true,
	allowOutsideClick = true,
	allowEscapeKey = true,
	onClose,
}) => {
	const [inputValue, setInputValue] = useState('');

	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && allowEscapeKey) {
				onClose({ value: null, isConfirmed: false, isDismissed: true, dismiss: 'esc' });
			}
		};
		window.addEventListener('keydown', handleEscape);
		return () => window.removeEventListener('keydown', handleEscape);
	}, [onClose, allowEscapeKey]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onClose({ value: inputValue || null, isConfirmed: true });
	};

	const handleBackdropClick = () => {
		if (allowOutsideClick) {
			onClose({ value: null, isConfirmed: false, isDismissed: true, dismiss: 'backdrop' });
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={handleBackdropClick}
		>
			<div
				className="w-full max-w-md rounded-lg bg-gray-900 p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				{title && (
					<h2 className="mb-4 text-center text-xl font-bold text-gray-100">{title}</h2>
				)}
				<form onSubmit={handleSubmit}>
					<input
						type="text"
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						placeholder={inputPlaceholder}
						className="mb-6 w-full rounded border border-gray-700 bg-gray-800 p-2 text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-hidden"
						autoFocus
					/>
					<div className="sibling-space-x-3 flex justify-center">
						<button
							type="submit"
							className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-800 focus:ring-2 focus:ring-cyan-500 focus:outline-hidden"
						>
							OK
						</button>
						{showCancelButton && (
							<button
								type="button"
								onClick={() =>
									onClose({
										value: null,
										isConfirmed: false,
										isDismissed: true,
										dismiss: 'cancel',
									})
								}
								className="rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600 focus:ring-2 focus:ring-gray-500 focus:outline-hidden"
							>
								Cancel
							</button>
						)}
					</div>
				</form>
			</div>
		</div>
	);
};

const CustomHtmlDialog: React.FC<FireOptions & BaseModalProps> = ({
	title,
	html,
	poster,
	preConfirm,
	showCancelButton = true,
	confirmButtonText = 'OK',
	cancelButtonText = 'Cancel',
	showConfirmButton = true,
	showDenyButton = false,
	denyButtonText,
	allowOutsideClick = true,
	allowEscapeKey = true,
	didOpen,
	onClose,
}) => {
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && allowEscapeKey) {
				onClose({ isConfirmed: false, isDismissed: true, dismiss: 'esc' });
			}
		};
		window.addEventListener('keydown', handleEscape);
		return () => window.removeEventListener('keydown', handleEscape);
	}, [onClose, allowEscapeKey]);

	const didOpenRef = useRef(false);
	useEffect(() => {
		if (!didOpen || didOpenRef.current) return;
		didOpenRef.current = true;
		const rAF = requestAnimationFrame(() => {
			didOpen();
		});
		return () => {
			cancelAnimationFrame(rAF);
		};
	}, [didOpen]);

	const handleConfirm = async () => {
		if (preConfirm) {
			const result = await preConfirm();
			if (result === false) return;
			onClose({ isConfirmed: true, value: result });
		} else {
			onClose({ isConfirmed: true });
		}
	};

	const handleBackdropClick = () => {
		if (allowOutsideClick) {
			onClose({ isConfirmed: false, isDismissed: true, dismiss: 'backdrop' });
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={handleBackdropClick}
		>
			<div className="relative w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
				{/* A dialog with no buttons otherwise closes only on the backdrop, a thin
				    strip on a phone; outside the scroller so it stays put. */}
				{!showConfirmButton && !showDenyButton && !showCancelButton && (
					<button
						type="button"
						aria-label="Close"
						onClick={() =>
							onClose({ isConfirmed: false, isDismissed: true, dismiss: 'close' })
						}
						className="absolute top-2 right-2 z-10 rounded-full p-2 text-gray-400 hover:bg-gray-800 hover:text-white"
					>
						<X className="h-5 w-5" />
					</button>
				)}
				<div className="max-h-[90vh] overflow-auto rounded-lg bg-gray-900 p-6 shadow-xl">
					{title && (
						<h2 className="mb-4 text-center text-xl font-bold text-gray-100">
							{title}
						</h2>
					)}
					{poster && (
						// Hidden on phones, where it pushes the release details below the fold.
						<div
							className="mx-auto mb-3 hidden w-32 sm:block"
							data-testid="dialog-poster"
						>
							<Poster imdbId={poster.imdbId} title={poster.title} />
						</div>
					)}
					{html && (
						<div
							className="mb-6 text-gray-100"
							dangerouslySetInnerHTML={{ __html: html }}
						/>
					)}
					{(showConfirmButton || showDenyButton || showCancelButton) && (
						<div className="sibling-space-x-3 flex justify-center">
							{showConfirmButton && (
								<button
									onClick={handleConfirm}
									className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-800 focus:ring-2 focus:ring-cyan-500 focus:outline-hidden"
								>
									{confirmButtonText}
								</button>
							)}
							{showDenyButton && (
								<button
									onClick={() => onClose({ isConfirmed: false, isDenied: true })}
									className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
								>
									{denyButtonText}
								</button>
							)}
							{showCancelButton && (
								<button
									onClick={() =>
										onClose({
											isConfirmed: false,
											isDismissed: true,
											dismiss: 'cancel',
										})
									}
									className="rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600 focus:ring-2 focus:ring-gray-500 focus:outline-hidden"
								>
									{cancelButtonText}
								</button>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
