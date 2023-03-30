import { useState } from "react";

interface MyAccount {
    libraryType: '1080p' | '2160p';
}

export const useMyAccount = () => {
    const myAccount = useState<MyAccount>({ libraryType: '2160p' });
};
