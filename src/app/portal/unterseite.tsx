import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db } from '@/server/db/pool';
import { bindeAnfrage } from '@/server/kontext/index';
import { findeRoute } from '@/server/registry/routen';
import { NochNichtGebaut } from '@/components/portal/NochNichtGebaut';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { AnmeldungNoetig } from './Anmeldung';
import { portalWurzel, portalZugang, type PortalZugang } from './zugang';
import { meinBeschriftungen, meinTexte } from '@/lib/i18n/texte';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Die gemeinsame Antwort fuer jede Portalroute, deren Modul noch nicht gebaut
 * ist.
 *
 * **Warum es sie gibt.** `04-SEITENKARTE.md` fuehrt 432 Routen; gebaut sind
 * die von Phase 3. Die Tab-Leisten verlangen nach §11.2 genau fuenf Ziele je
 * Portal, und darunter sind Module aus Phase 4 bis 9. Ohne diese Seite fuehrte
 * jeder solche Tab auf ein Next-404 — also auf die Auskunft "diese Seite gibt
 * es nicht" fuer eine Seite, die das Dokument fuehrt und die Leiste anbietet.
 *
 * **Die Wache bleibt dieselbe.** Es laeuft `portalZugang`: eine Route, die
 * nicht im Manifest steht, faellt weiter auf 404, ein fehlendes Recht ebenso,
 * und ein fremdes Portal auf die K-04-Decke. Diese Datei fuegt keine
 * Erreichbarkeit hinzu — sie ersetzt nur die falsche Antwort durch die wahre.
 */

const BEREICHE = new Set<string>(['reinigung', 'security', 'bau', 'operations']);

function bereichAus(slug: string | undefined): BereichSchluessel | null {
  return slug !== undefined && BEREICHE.has(slug) ? (slug as BereichSchluessel) : null;
}

export interface UnterseiteProps {
  /** Die konkrete URL, so wie der Browser sie geschickt hat. */
  readonly pfad: string;
  /**
   * Die Portalwurzel — oder `undefined`, dann kommt sie aus der Sitzung.
   *
   * Die Kontoseiten brauchen das: `/portal/konto/...` ist keine Portalwurzel,
   * und die Leiste dort relativ zu ihr aufzuloesen ergaebe
   * `/portal/konto/auftraege` — eine Adresse, die es nicht gibt.
   */
  readonly wurzel?: string;
  readonly bereich: BereichSchluessel | null;
}

/**
 * Prueft den Slug einer `/portal/[mandant]/…`-Adresse gegen die Sitzung.
 *
 * §4.5, Zeile fuer Zeile: gleich dem aktiven Bereich → weiter. Ein Bereich,
 * in dem der Benutzer Mitglied ist, aber nicht der aktive → dasselbe
 * Zwischenblatt, denn **ein GET wechselt den Mandanten nie**. Alles andere →
 * 404, nie 403.
 */
export interface SlugWechsel {
  readonly art: 'wechsel';
  /** Was gerade aktiv ist, in Worten — `null` heisst: kein Bereich. */
  readonly aktuell: string | null;
  readonly ziel: string;
  /** Der Name des Ziels, wo die Sitzung ihn lesen darf — sonst `null`. */
  readonly zielName: string | null;
  /** Die Adresse, die gemeint war: nach dem Wechsel geht es dorthin zurueck. */
  readonly zurueck: string;
}

export async function slugTor(
  zugang: PortalZugang, slug: string,
): Promise<{ art: 'ok' } | SlugWechsel> {
  /**
   * Die Gruppensitzung: das Tor hat den Bereich schon aufgeloest (D-474),
   * und „aktuell" ist kein Bereich, sondern die Gruppenansicht. Das Blatt
   * sagt das in Worten, denn `null` hiesse „ohne aktiven Bereich" — und das
   * ist eine andere Lage (ein `intern`-Konto vor der Bereichswahl).
   */
  if (zugang.wechselZiel !== null && zugang.wechselZiel.slug === slug) {
    return {
      art: 'wechsel', aktuell: 'der Gruppenübersicht', ziel: slug,
      zielName: zugang.wechselZiel.name, zurueck: zugang.pfad,
    };
  }
  /**
   * Der haeufige Fall kostet KEINE Abfrage.
   *
   * `portalZugang` hat den Slug des aktiven Bereichs schon gelesen — in
   * derselben gebundenen Transaktion, in der es das Recht geprueft hat.
   * Stimmt er, ist nichts mehr zu fragen; das ist jeder normale Seitenaufruf.
   * Nur die Abweichung kostet eine zweite Transaktion, und die ist selten.
   */
  if (slug === zugang.mandantSlug) return { art: 'ok' };

  const befund = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, zugang.sitzung);
    const [z] = (await tx.unsafe(
      `select app.mandant_fuer_wechsel($1) as ziel_id,
              (select m.name from mandant m where m.id = $2) as aktuell`,
      [slug, zugang.sitzung.aktiverMandantId],
    )) as { ziel_id: string | null; aktuell: string | null }[];
    return { zielId: z?.ziel_id ?? null, aktuell: z?.aktuell ?? null };
  }) as Promise<{ zielId: string | null; aktuell: string | null }>);

  // Unbekannter Slug UND fremder Bereich geben hier dieselbe `null` zurueck —
  // die Funktion in der Datenbank unterscheidet sie absichtlich nicht (AUT-06).
  if (befund.zielId === null) notFound();
  return { art: 'wechsel', aktuell: befund.aktuell, ziel: slug, zielName: null, zurueck: zugang.pfad };
}

/**
 * Das Tor einer `/portal/[mandant]/…`-Seite in EINEM Aufruf: Sitzung, Recht,
 * Slug — und die Antwort, wenn eines davon nicht passt.
 *
 * Das Muster stand in ueber hundert Seiten je viermal ausgeschrieben
 * (`portalZugang`, `AnmeldungNoetig`, `slugTor`, `Wechselblatt`, `notFound`).
 * Vier Zeilen sind kein Drama — bis eine Seite die dritte vergisst. Neue
 * Seiten nehmen dieses Tor; die alten bleiben, wie sie sind.
 */
export type MandantTor =
  | { readonly art: 'anmeldung' }
  | { readonly art: 'wechsel'; readonly blatt: SlugWechsel; readonly slug: string }
  | { readonly art: 'ok'; readonly zugang: PortalZugang; readonly mandantId: string };

export async function mandantTor(pfad: string, slug: string): Promise<MandantTor> {
  const zugang = await portalZugang(pfad);
  if (zugang === null) return { art: 'anmeldung' };
  const tor = await slugTor(zugang, slug);
  if (tor.art === 'wechsel') return { art: 'wechsel', blatt: tor, slug };
  // Nach `slugTor` ist der aktive Bereich der des Pfads; ohne aktiven Bereich
  // (K-20) gibt es diese Seite nicht.
  if (zugang.sitzung.aktiverMandantId === null) notFound();
  return { art: 'ok', zugang, mandantId: zugang.sitzung.aktiverMandantId };
}

/** Die Antwort auf ein Mandantstor, das nicht `ok` sagt. */
export function MandantAntwort({ tor }: { readonly tor: Exclude<MandantTor, { art: 'ok' }> }) {
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  return (
    <Wechselblatt
      aktuell={tor.blatt.aktuell}
      zielTitel={tor.blatt.zielName ?? tor.slug}
      zielSlug={tor.blatt.ziel}
      zurueck={tor.blatt.zurueck}
    />
  );
}

export async function Unterseite({ pfad, wurzel, bereich }: UnterseiteProps) {
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const route = findeRoute(pfad);
  const echteWurzel = wurzel ?? portalWurzel(zugang);
  return (
    <NochNichtGebaut
      titel={echteWurzel === '/portal/gruppe' ? 'Gruppenübersicht' : 'Portal'}
      bereich={bereich}
      leiste={zugang.leiste}
      wurzel={echteWurzel}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      phase={route?.phase ?? null}
      pfad={route?.pfad ?? pfad}
      /* Die Arbeiterleiste in der Sprache der Person — auch auf einem Ziel,
         das es noch nicht gibt (D-419). */
      {...(zugang.sprache === null
        ? {} : { beschriftungen: meinBeschriftungen(meinTexte(zugang.sprache)) })}
    />
  );
}

/** Die Variante unter `/portal/[mandant]/…` — mit der Slug-Pruefung davor. */
export async function MandantUnterseite({ segmente, mandant }: {
  readonly segmente: readonly string[];
  readonly mandant: string;
}) {
  const pfad = `/portal/${[mandant, ...segmente].join('/')}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }

  const route = findeRoute(pfad);
  return (
    <NochNichtGebaut
      titel="Portal"
      bereich={bereichAus(mandant)}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      phase={route?.phase ?? null}
      pfad={route?.pfad ?? pfad}
    />
  );
}
