'use server';

import { cookies } from 'next/headers';
import {
  isSupportedLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from './config';

/**
 * Persist the visitor's manual language choice (M3.9 switcher). Server action, so
 * it works for signed-in AND anonymous visitors alike — the cookie is independent
 * of the session.
 *
 * Security: the value is validated against the strict allowlist before it is ever
 * written, so a forged form post can't smuggle an arbitrary value into the cookie.
 * The read path (negotiation) revalidates too, so even a hand-set cookie can only
 * ever select a supported locale. httpOnly: the value is server-read only — the
 * switcher's current selection comes from the request-config locale (useLocale),
 * not from JS reading the cookie — so it need never be exposed to scripts.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isSupportedLocale(locale)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE_NAME, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
}
