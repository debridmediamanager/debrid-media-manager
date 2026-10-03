import { AlertTriangle, CheckCircle, HelpCircle, Info, Loader2, XCircle } from 'lucide-react';
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

				let type: ModalState['type'] = 'confirm';
				if (options.input === 'text') {
					type = 'input';
				} else if (options.showDenyButton) {
					type = 'choice';
				} else if (options.html && !options.text) {
					type = 'custom';
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
	<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
		<div className="rounded-lg bg-gray-900 p-6 shadow-xl">
			<div className="flex items-center space-x-3">
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
			className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
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
				<div className="flex justify-center space-x-3">
					<button
						onClick={() => onClose({ isConfirmed: true })}
						className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
							className="rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
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
			className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
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
				<div className="flex justify-center space-x-3">
					<button
						onClick={() => onClose({ isConfirmed: true, isDenied: false })}
						className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-500"
					>
						{confirmButtonText}
					</button>
					<button
						onClick={() => onClose({ isConfirmed: false, isDenied: true })}
						className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
					>
						{denyButtonText}
					</button>
					{showCancelButton && (
						<button
							onClick={() =>
								onClose({ isConfirmed: false, isDenied: false, isDismissed: true })
							}
							className="rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
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
			className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
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
						className="mb-6 w-full rounded border border-gray-700 bg-gray-800 p-2 text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
						autoFocus
					/>
					<div className="flex justify-center space-x-3">
						<button
							type="submit"
							className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
								className="rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
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
	preConfirm,
	showCancelButton = true,
	confirmButtonText = 'OK',
	cancelButtonText = 'Cancel',
	showConfirmButton = true,
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
			className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
			onClick={handleBackdropClick}
		>
			<div
				className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-gray-900 p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				{title && (
					<h2 className="mb-4 text-center text-xl font-bold text-gray-100">{title}</h2>
				)}
				{html && (
					<div
						className="mb-6 text-gray-100"
						dangerouslySetInnerHTML={{ __html: html }}
					/>
				)}
				{(showConfirmButton || showCancelButton) && (
					<div className="flex justify-center space-x-3">
						{showConfirmButton && (
							<button
								onClick={handleConfirm}
								className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-500"
							>
								{confirmButtonText}
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
								className="rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
							>
								{cancelButtonText}
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
};
