import Link from 'next/link';
import type postgres from 'postgres';
import type { ReactNode } from 'react';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import type { LeseKontext } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import type { BereichSchluessel } from '@/lib/design/theme';
import { leserechte, routeMitPfad } from '@/server/registry/routen';
import { MandantAntwort, mandantTor } from '../../unterseite';
import { haeltRechte } from '../../rechte';
import type { PortalZugang } from '../../zugang';

/**
 * Die Hülle aller Recruiting-Seiten — ein Tor, eine Leiste, eine Sprungzeile.
 *
 * **Warum eine gemeinsame Hülle.** Fünfzehn Seiten mit je vier kopierten
 * Zeilen (`portalZugang`, `AnmeldungNoetig`, `slugTor`, `Wechselblatt`) sind
 * fünfzehn Gelegenheiten, die dritte zu vergessen — und die vergessene dritte
 * war D-566: eine Seite reichte den Abschnitt statt der Portalwurzel durch
 * und brach damit ihre ganze Navigation.
 *
 * **Die Sprungzeile zeigt nur, was diese Sitzung öffnen darf** (AUT-06). Ein
 * Menüpunkt, der auf 404 führt, ist schlechter als keiner; D-567 hat sieben
 * davon gefunden, und diese Datei ist die Stelle, an der sie hier nicht
 * entstehen.
 */

export interface RecruitingSeiteProps {
  readonly mandant: string;
  readonly unterpfad: string;
  readonly titel: string;
  readonly kinder: (zugang: PortalZugang) => Promise<ReactNode>;
}

/**
 * Die Sprungzeile — **mit den Rechten aus dem ROUTENMANIFEST, nicht mit
 * abgeschriebenen.**
 *
 * Hier stand je Sprung EIN handgesetzter Schlüssel. Zwei davon waren zu
 * milde: `/recruiting/bedarf` verlangt zusätzlich `dienstplan.lesen` (es liest
 * unbesetzte Schichten), `/recruiting/gespraeche` zusätzlich
 * `kalender.schreiben` (es legt Termine). Wer das eine Recht hielt und das
 * andere nicht, sah den Knopf und bekam dahinter 404 — genau der Fall, gegen
 * den diese Zeile gebaut ist (AUT-06, D-567). Gemeldet hat es die
 * Copilot-Runde auf PR 16.
 *
 * Eine dritte Kopie wäre dieselbe Wette noch einmal. `leserechte()` liest
 * deshalb die Bedingung DORT, wo die Route sie auch wirklich prüft; ein
 * zusätzliches Recht am Manifest wandert damit von selbst in diese Zeile.
 */
const SPRUNGZIELE: readonly { readonly pfad: string; readonly text: string }[] = [
  { pfad: '', text: 'Übersicht' },
  { pfad: 'bedarf', text: 'Bedarf' },
  { pfad: 'stellen', text: 'Stellen' },
  { pfad: 'bewerbungen', text: 'Bewerbungen' },
  { pfad: 'kandidaten', text: 'Kandidaten' },
  { pfad: 'gespraeche', text: 'Gespräche' },
  { pfad: 'datenschutz', text: 'Datenschutz' },
];

/**
 * Ein Sprung ohne Eintrag im Manifest bekommt eine LEERE Rechteliste und
 * verschwindet damit aus der Zeile — nicht „offen für alle".
 *
 * Das ist die sichere Richtung: ein Tippfehler im Pfad kostet einen Knopf,
 * kein Recht. Dass es den Eintrag geben MUSS, hält
 * `tests/kern/recruiting-spruenge.test.ts` fest; dort fällt der Tippfehler
 * auf, und nicht erst dem Menschen, dem der Knopf fehlt.
 */
function rechteZu(unterpfad: string): readonly string[] {
  const r = routeMitPfad(
    `/portal/[mandant]/recruiting${unterpfad === '' ? '' : `/${unterpfad}`}`);
  return r === undefined ? [] : leserechte(r);
}

const SPRUENGE = SPRUNGZIELE.map((z) => ({ ...z, rechte: rechteZu(z.pfad) }));

export async function RecruitingSeite(
  { mandant, unterpfad, titel, kinder }: RecruitingSeiteProps,
) {
  const pfad = unterpfad === ''
    ? `/portal/${mandant}/recruiting`
    : `/portal/${mandant}/recruiting/${unterpfad}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(zugang.sitzung, ...SPRUENGE.flatMap((s) => s.rechte));
  const inhalt = await kinder(zugang);

  return (
    <PortalRahmen
      titel={titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="recruiting"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Recruiting" data-cse="recruiting-spruenge"
           className="mb-s5 flex flex-wrap gap-s2">
        {SPRUENGE.filter((s) => s.rechte.length > 0
          && s.rechte.every((r) => darf[r] === true)).map((s) => {
          /*
           * **Die Unterseite hebt ihren Zweig hervor.** `unterpfad` ist seit
           * der Rechtekorrektur der VOLLE Pfad (`stellen/<id>/…`), damit das
           * Tor gegen die richtige Manifestzeile prueft; die Zeile darueber
           * zeigt trotzdem weiter „Stellen" als aktiv, weil ein Mensch dort
           * steht.
           */
          const aktiv = s.pfad === unterpfad
            || (s.pfad !== '' && unterpfad.startsWith(`${s.pfad}/`));
          return (
            <Link
              key={s.pfad}
              /*
               * Die Vorlage steht INLINE und nicht in einer `const` darueber.
               * `typedRoutes` prueft `href` gegen einen Vorlagen-Literaltyp;
               * eine Zwischenvariable verbreitert ihn auf `string`, und dann
               * ist er kein `RouteImpl` mehr. Dieselbe Form benutzt die
               * Seitenleiste.
               */
              href={`/portal/${mandant}/recruiting${s.pfad === '' ? '' : `/${s.pfad}`}`}
              data-cse="recruiting-sprung"
              aria-current={aktiv ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-md border px-s3 text-sm
                          transition-colors duration-fast ${aktiv
                            ? 'border-line-strong bg-surface-2 text-text'
                            : 'border-line text-text-muted hover:border-line-strong hover:text-text'}`}
            >
              {s.text}
            </Link>
          );
        })}
      </nav>
      {inhalt}
    </PortalRahmen>
  );
}

/**
 * Eine Lesetransaktion im Mandanten der Sitzung — die vier Zeilen, die sonst
 * fünfzehnmal dastünden.
 *
 * `SCHNAPPSCHUSS`: eine Recruiting-Seite zeigt mehrere Listen nebeneinander
 * (Stellen, Bewerbungen, Bewertungen), und ohne wiederholbares Lesen könnten
 * zwei davon aus zwei verschiedenen Augenblicken stammen — eine Stelle mit
 * „3 Bewerbungen" über einer Liste mit vieren.
 */
export async function leseImMandanten<T>(
  zugang: PortalZugang, fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  return await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => fn(kontext))) as Promise<T>);
}
