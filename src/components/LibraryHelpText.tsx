interface LibraryHelpTextProps {
	helpText: string;
	onHide: () => void;
}

export default function LibraryHelpText({ helpText, onHide }: LibraryHelpTextProps) {
	if (!helpText || helpText === 'hide') return null;

	return (
		<div className="bg-blue-900 py-0.5 text-xs" onClick={onHide}>
			💡 {helpText}
		</div>
	);
}
