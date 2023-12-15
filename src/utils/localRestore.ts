export async function localRestore(callback: (files: any[]) => void): Promise<void> {
	const filePicker = document.createElement('input');
	filePicker.type = 'file';
	filePicker.accept = '.json';
	let file: File | null = null;

	filePicker.onchange = (e: Event) => {
		const target = e.target as HTMLInputElement;
		file = target.files ? target.files[0] : new File([], '');
	};
	filePicker.click();

	filePicker.addEventListener('change', async () => {
		if (!file) return;

		const reader: FileReader = new FileReader();
		reader.readAsText(file, 'UTF-8');
		reader.onload = async function (evt: ProgressEvent<FileReader>) {
			const files: any[] = JSON.parse(evt.target?.result as string);
			callback(files);
		};
	});
}
