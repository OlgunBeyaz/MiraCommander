import { writable, get } from 'svelte/store';
import en from './locales/en.json';
import tr from './locales/tr.json';

const messages: Record<string, Record<string, any>> = {
  en,
  tr,
};

function detectDefault() {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language.split('-')[0];
  }
  return 'en';
}

export const available = ['en', 'tr'];
export const locale = writable(detectDefault());

export function setLocale(l: string) {
  if (available.includes(l)) locale.set(l);
}

function lookup(key: string, loc: string) {
  const parts = key.split('.');
  let cur: any = messages[loc] ?? messages['en'];
  for (const p of parts) {
    if (!cur) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function t(key: string, vars?: Record<string, string | number>) {
  const loc = get(locale) || 'en';
  let val = lookup(key, loc) ?? lookup(key, 'en') ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      val = String(val).replace(`{${k}}`, String(vars[k]));
    }
  }
  return val;
}

export default { locale, t, setLocale, available };
