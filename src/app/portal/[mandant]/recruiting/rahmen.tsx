import Link from 'next/link';
import type postgres from 'postgres';
import type { ReactNode } from 'react';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import type { LeseKontext } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import type { BereichSchluessel } from '@/lib/design/theme';
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

const SPRUENGE: readonly { readonly pfad: string; readonly text: string;
  readonly recht: string }[] = [
  { pfad: '', text: 'Übersicht', recht: 'recruiting.bewerbung_lesen' },
  { pfad: 'bedarf', text: 'Bedarf', recht: 'recruiting.bewerbung_lesen' },
  { pfad: 'stellen', text: 'Stellen', recht: 'recruiting.stelle_schreiben' },
  { pfad: 'bewerbungen', text: 'Bewerbungen', recht: 'recruiting.bewerbung_lesen' },
  { pfad: 'kandidaten', text: 'Kandidaten', recht: 'recruiting.bewerbung_lesen' },
  { pfad: 'gespraeche', text: 'Gespräche', recht: 'recruiting.bewerbung_lesen' },
  { pfad: 'datenschutz', text: 'Datenschutz', recht: 'recruiting.daten_loeschen' },
];

export async function RecruitingSeite(
  { mandant, unterpfad, titel, kinder }: RecruitingSeiteProps,
) {
  const pfad = unterpfad === ''
    ? `/portal/${mandant}/recruiting`
    : `/portal/${mandant}/recruiting/${unterpfad}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(zugang.sitzung, ...SPRUENGE.map((s) => s.recht));
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
        {SPRUENGE.filter((s) => darf[s.recht] === true).map((s) => {
          const aktiv = s.pfad === unterpfad;
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
