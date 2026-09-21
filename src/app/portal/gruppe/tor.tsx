import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { bindeAnfrage, withGroupScope, type LeseKontext } from '@/server/kontext/index';
import type { ZurueckProps } from '@/components/portal/Zurueck';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { AreaBadge } from '@/components/ui/AreaBadge';
import type { BereichSchluessel } from '@/lib/design/theme';
import { AnmeldungNoetig } from '../Anmeldung';
import { portalZugang, type PortalZugang } from '../zugang';

/**
 * Das gemeinsame Tor jeder Seite unter `/portal/gruppe/…` (TEN-05, Invariante 10).
 *
 * **Eine Stelle, nicht siebzehn.** Jede Gruppenseite muss dasselbe tun:
 * Sitzung holen, Tor fragen, und — traegt die Sitzung die Gruppenansicht
 * nicht — das Zwischenblatt zeigen oder 404 antworten (§4.5: *ein GET betritt
 * die Gruppenansicht nicht*). Die Uebersicht hatte diese Logik als
 * `vorentscheid` fuer sich allein; mit der zweiten Seite waere sie kopiert
 * worden, mit der zwoelften vergessen.
 *
 * **Lesend per Konstruktion.** `gruppenLesen` gibt einen `LeseKontext` und
 * nichts sonst: ein Schreibversuch auf einer Gruppenseite ist ein
 * Compilerfehler. Die zweite Linie steht trotzdem — keine Tabelle kennt fuer
 * `app.scope() = 'gruppe'` eine Schreib-Policy.
 */
export type GruppenTor =
  | { readonly art: 'anmeldung' }
  | {
    readonly art: 'wechsel';
    readonly aktuellerName: string | null;
    /** Der Slug des aktuellen Bereichs — fuer sein Zeichen (DESIGN §5). */
    readonly aktuellerSlug: string | null;
    readonly pfad: string;
  }
  | { readonly art: 'ok'; readonly zugang: PortalZugang };

interface Vorentscheid {
  readonly darf: boolean;
  readonly aktuellerName: string | null;
}

/** Was §4.5 fuer eine Sitzung ohne Gruppenansicht vorsieht. */
async function vorentscheid(sitzung: PortalZugang['sitzung']): Promise<Vorentscheid> {
  return db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    const [z] = (await tx.unsafe(
      `select app.darf_gruppenansicht() as darf,
              (select m.name from mandant m where m.id = $1) as name`,
      [sitzung.aktiverMandantId],
    )) as { darf: boolean; name: string | null }[];
    return { darf: z?.darf === true, aktuellerName: z?.name ?? null };
  }) as Promise<Vorentscheid>;
}

export async function gruppenTor(pfad: string): Promise<GruppenTor> {
  const zugang = await portalZugang(pfad);
  if (zugang === null) return { art: 'anmeldung' };
  if (zugang.sitzung.ansicht === 'gruppe') return { art: 'ok', zugang };

  const { darf, aktuellerName } = await vorentscheid(zugang.sitzung);
  // 404 und nicht 403: eine Absage, die sich von "gibt es nicht"
  // unterscheidet, ist eine Auskunft ueber das, was es gibt (AUT-06).
  if (!darf) notFound();
  return { art: 'wechsel', aktuellerName, aktuellerSlug: zugang.mandantSlug, pfad };
}

/** Die Antwort auf ein Tor, das nicht `ok` sagt. */
export function GruppenAntwort({ tor }: { readonly tor: Exclude<GruppenTor, { art: 'ok' }> }) {
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  return (
    <Wechselblatt
      aktuell={tor.aktuellerName}
      aktuellSlug={tor.aktuellerSlug}
      zielTitel="Gruppenübersicht"
      zielSlug={null}
      zurueck={tor.pfad}
    />
  );
}

/** Eine Lesetransaktion im Gruppen-Scope — Schnappschuss, ein Kontext, kein Schreibpfad. */
export async function gruppenLesen<T>(
  zugang: PortalZugang, fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  return db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withGroupScope(tx, zugang.sitzung, fn)) as Promise<T>;
}

export interface Bereich {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/**
 * Die Bereiche dieser Gruppenansicht — aus `mandant`, also aus der Policy:
 * `t_mandant_lesen` gibt genau die Zeilen der sichtbaren Menge zurueck, und
 * die kommt aus `app.switcher_mandanten()` (K-18), nicht aus der Anwendung.
 */
export async function ladeBereiche(kontext: LeseKontext): Promise<readonly Bereich[]> {
  return kontext.abfrage<Bereich>(
    `select id, slug, name from mandant order by sortierung, slug`,
  );
}

const BEREICHE = new Set<string>(['reinigung', 'security', 'bau', 'operations']);

export function bereichSchluessel(slug: string): BereichSchluessel | null {
  return BEREICHE.has(slug) ? (slug as BereichSchluessel) : null;
}

/** Die Marke eines Bereichs in einer Zeile — Identitaetsfarbe nur zur Kennung (DESIGN §3). */
export function BereichMarke({ slug, name }: { readonly slug: string; readonly name: string }) {
  const b = bereichSchluessel(slug);
  return b === null ? <span className="text-sm text-text">{name}</span> : <AreaBadge bereich={b} />;
}

/**
 * Der Bereichsfilter (DSH-02: *alle Bereiche oder einer*).
 *
 * Verweise, keine Knoepfe: der Filter ist Teil der Adresse, damit ein
 * kopierter Link dieselbe Sicht zeigt — und weil eine Gruppenseite keinen
 * Zustand im Browser haelt, den ein Neuladen vergaesse. Dieselbe Form wie
 * `FilterPill` (DESIGN §5), nur als `<a>` mit `aria-current`.
 */
export function BereichFilter({ bereiche, aktiv, basis }: {
  readonly bereiche: readonly Bereich[];
  readonly aktiv: Bereich | null;
  readonly basis: string;
}) {
  // Dieselben Klassen wie `FilterPill` — eine Form fuer eine Sache (DESIGN §5).
  const pille = (istAktiv: boolean): string => [
    'inline-flex min-h-11 shrink-0 items-center rounded-full px-s4 text-sm',
    'transition-colors duration-fast ease-brand',
    istAktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');
  return (
    <nav aria-label="Bereich" data-cse="bereichs-filter" className="mb-s5 flex flex-wrap gap-s2">
      {/* `<a>`, nicht `Link`: das Ziel ist eine Adresse mit Abfrage, die
          `typedRoutes` nicht als Route kennt — wie die Kacheln (`KachelRaster`). */}
      <a href={basis} aria-current={aktiv === null ? 'page' : undefined}
         className={pille(aktiv === null)}>
        Alle Bereiche
      </a>
      {bereiche.map((b) => (
        <a key={b.slug} href={`${basis}?bereich=${b.slug}`}
           aria-current={aktiv?.slug === b.slug ? 'page' : undefined}
           data-bereich={b.slug}
           className={pille(aktiv?.slug === b.slug)}>
          {b.name}
        </a>
      ))}
    </nav>
  );
}

export type Suchparameter = Promise<Record<string, string | string[] | undefined>>;

/** Der gewaehlte Bereich aus `?bereich=` — oder `null` fuer alle. Unbekanntes ist „alle". */
export async function bereichAus(
  suchparameter: Suchparameter | undefined, bereiche: readonly Bereich[],
): Promise<Bereich | null> {
  const p = suchparameter === undefined ? {} : await suchparameter;
  const roh = p['bereich'];
  const slug = typeof roh === 'string' ? roh : null;
  return bereiche.find((b) => b.slug === slug) ?? null;
}

/** Die Mandanten-IDs, auf die eine Liste eingeschraenkt wird: der gewaehlte oder alle. */
export function mandantIdsFuer(kontext: LeseKontext, aktiv: Bereich | null): readonly string[] {
  return aktiv === null ? kontext.mandantIds : [aktiv.id];
}

/** Eine Zelle, deren Recht in diesem Bereich fehlt — kein Wert, keine Null. */
export function KeinRecht() {
  return (
    <span data-cse="kein-recht" className="text-text-subtle" title="Kein Leserecht in diesem Bereich">
      —
    </span>
  );
}

/** Der Rahmen jeder Gruppenseite: neutraler Streifen, `NUR LESEN`, Gruppenleiste. */
export function GruppenRahmen({ zugang, titel, aktiverTab, zurueck, children }: {
  readonly zugang: PortalZugang;
  readonly titel: string;
  readonly aktiverTab: string;
  /**
   * Der Weg eine Ebene hinauf — durchgereicht an `PortalRahmen`
   * (DESIGN §5 „The way back", D-613).
   *
   * Er steht hier als Durchreiche und nicht als eigener Baustein, damit der
   * Pfeil in jedem Portal an derselben Stelle sitzt: zuerst im `main`, vor
   * jeder Ueberschrift.
   */
  readonly zurueck?: ZurueckProps;
  readonly children: ReactNode;
}) {
  return (
    <PortalRahmen
      titel={titel}
      {...(zurueck === undefined ? {} : { zurueck })}
      wurzelTitel="Gruppenübersicht"
      bereich={null}
      nurLesen
      leiste={zugang.leiste}
      wurzel="/portal/gruppe"
      aktiverTab={aktiverTab}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {children}
    </PortalRahmen>
  );
}

/** Die leere Liste sagt, dass sie leer ist — und nicht, dass etwas fehlt. */
export function LeereListe({ text }: { readonly text: string }) {
  return (
    <p data-cse="leere-liste"
       className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
      {text}
    </p>
  );
}

/** Der Vermerk unter jeder Gruppenliste: gehandelt wird im Bereich. */
export function GruppenHinweis({ text }: { readonly text: string }) {
  return <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">{text}</p>;
}
