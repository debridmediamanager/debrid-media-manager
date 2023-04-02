import useLocalStorage from './localStorage';

export interface MyAccount {
	libraryType: '1080p' | '2160p';
}

function useMyAccount() {
	return useLocalStorage<MyAccount>('myAccount', {
		libraryType: '2160p',
	});
}

export default useMyAccount;
