import { createContext, useContext } from 'react';

export const UiLanguageContext = createContext('he');

export function useUiLanguage() {
  return useContext(UiLanguageContext);
}
