import useLocalStorage from './localStorage';

export interface MyAccount {
	libraryType: '2160p' | '1080pOr2160p';
}

function useMyAccount() {
	return useLocalStorage<MyAccount>('myAccount', {
		libraryType: '1080pOr2160p',
	});
}

export default useMyAccount;
