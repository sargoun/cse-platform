import 'server-only';
import { keksSicher } from '@/server/auth/sitzung';
import type { Umgebung } from '@/lib/dev-flaechen';
import { SPRACH_KEKS_SEKUNDEN } from '@/lib/i18n/geraetesprache';

/**
 * Die Attribute des Sprachkekses — an EINER Stelle (V-200, D-694).
 *
 * Der Keks trägt einen von vier Werten (`de`, `en`, `ar`, `tr`) und nichts
 * über einen Menschen. Gesetzt wird er nur auf eine ausdrückliche Wahl, an
 * zwei Stellen: von der Sprachwahl der Flächen ohne Sitzung
 * (`/api/geraetesprache`) und beim Speichern der Sprache im Profil der
 * Arbeiterhülle (`/api/konto/sprache`) — damit Stempeluhr und Anmeldung auf
 * dem Telefon einer Kraft ihre Sprache sprechen, auch wenn sie abgemeldet
 * ist. Die Abmeldung löscht ihn deshalb nicht (D-751).
 *
 * - `path: '/'`: Stempeluhr (`/check-in/…`) und Anmeldung (`/auth/…`) lesen ihn.
 * - `httpOnly`: gelesen wird er nur auf dem Server; ein Skript braucht ihn nicht.
 * - `sameSite: 'lax'`: er reist mit, wenn die Kraft den Check-in-Link aus der
 *   SMS öffnet — das ist ein Aufruf von aussen, und genau für ihn ist er da.
 * - `secure` wie jeder Keks dieser Installation (`keksSicher`).
 * - **Kein `maxAge`, solange O-928 offen ist** (`SPRACH_KEKS_SEKUNDEN = null`):
 *   ein Sitzungskeks, der mit dem Browser endet.
 */
export function sprachKeksOptionen(umgebung: Umgebung = process.env): {
  httpOnly: true; sameSite: 'lax'; path: '/'; maxAge?: number; secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...(SPRACH_KEKS_SEKUNDEN === null ? {} : { maxAge: SPRACH_KEKS_SEKUNDEN }),
    secure: keksSicher(umgebung),
  };
}
