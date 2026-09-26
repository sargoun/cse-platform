import { Hinweis } from '@/components/ui/Hinweis';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import {
  RECRUITING_RUECKMELDUNG, type RecruitingRueckmeldungTexte,
} from '@/lib/i18n/verwaltung/recruiting-rueckmeldung';
import type { PortalSprache } from '@/lib/i18n/texte';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * Die Rückmeldung einer Recruiting-Seite auf ihr eigenes Formular
 * (V-148, D-642, D-562).
 *
 * `fuehreRecruitingAus` (`api/recruiting/gemeinsam.ts`) leitet eine
 * Abweisung mit `?fehler=<grund>` auf `zurueck` — und das ist bei den vier
 * Formularseiten die Seite selbst. Bis V-148 nahm keine davon Suchparameter
 * an: die Seite lud neu, die Eingaben waren weg, und nichts sagte warum.
 */
export type RueckmeldungSeite = keyof Pick<RecruitingRueckmeldungTexte,
  'bewertung' | 'entscheidung' | 'stelleNeu' | 'veroeffentlichung'>;

/**
 * Gründe, bei denen der Versuch GESCHRIEBEN ist (V-153).
 *
 * `fuehreRecruitingAus` schreibt zuerst und antwortet danach („Geschrieben ist
 * geschrieben", `api/recruiting/gemeinsam.ts`): eine Börse, die nicht
 * verbunden ist oder den Versuch ablehnt, hinterlässt einen Vermerk mit Datum
 * und Grund. Über diesen Sätzen stand trotzdem „Nicht gespeichert." — und der
 * Satz darunter sagte „vermerkt". Für sie gilt die Überschrift „Nicht
 * veröffentlicht.": gespeichert ist der Versuch, hinausgegangen ist nichts.
 */
export const VERMERKTE_GRUENDE: Readonly<Partial<Record<RueckmeldungSeite, ReadonlySet<string>>>> = {
  veroeffentlichung: new Set(['kanal_nicht_verbunden', 'veroeffentlichung_fehlgeschlagen']),
};

/** Der Grund aus den Suchparametern — ein Schlüssel oder nichts. */
export function grundAus(
  suche: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  const roh = suche['fehler'];
  return typeof roh === 'string' && /^[a-z_]{1,64}$/u.test(roh) ? roh : null;
}

export function RecruitingRueckmeldung({ sprache, seite, grund, eingabenErneut = false }: {
  readonly sprache: PortalSprache | null;
  readonly seite: RueckmeldungSeite;
  readonly grund: string | null;
  /** Das Formular hatte mehr als ein paar Felder — sagen, dass sie neu einzugeben sind. */
  readonly eingabenErneut?: boolean;
}) {
  if (grund === null) return null;
  const t = nachSprache(RECRUITING_RUECKMELDUNG, sprache);
  const vermerkt = VERMERKTE_GRUENDE[seite]?.has(grund) === true;
  return (
    <Hinweis art="warnung" cse="recruiting-rueckmeldung" className="mb-s5 max-w-prose">
      <strong>{vermerkt ? t.nichtVeroeffentlicht : t.nichtGespeichert}</strong>{' '}
      {eigenerEintrag(t[seite], grund) ?? t.abgewiesen}
      {eingabenErneut ? <span className="mt-s2 block">{t.eingabenErneut}</span> : null}
    </Hinweis>
  );
}

/**
 * Der Erfolg der Veröffentlichung — `?gesendet=1` aus
 * `api/recruiting/stellen/[id]/veroeffentlichen`. Auch er kam bisher auf
 * einer Seite an, die ihn nicht las.
 */
export function VeroeffentlichtHinweis({ sprache, gesendet }: {
  readonly sprache: PortalSprache | null;
  readonly gesendet: boolean;
}) {
  if (!gesendet) return null;
  const t = nachSprache(RECRUITING_RUECKMELDUNG, sprache);
  return (
    <Hinweis art="erfolg" cse="recruiting-veroeffentlicht" className="mb-s5 max-w-prose">
      {t.veroeffentlicht}
    </Hinweis>
  );
}
