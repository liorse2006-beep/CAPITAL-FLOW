import { createContext, useContext } from 'react';

export const UiLanguageContext = createContext('en');

export function useUiLanguage() {
  return useContext(UiLanguageContext);
}
