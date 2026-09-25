import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { tagePlus } from '@/lib/datum/kalendertag';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import {
  assertBesetzungVeroeffentlichbar, PostenUnterbesetzt,
} from '@/server/services/security/posten';
import {
  leseAnforderungen, waehlbareQualifikationen, type AnforderungZeile,
} from '@/server/services/security/anforderung';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { ANFORDERUNG_TEXTE } from '@/lib/i18n/verwaltung/anforderung';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { Anforderungsblock } from '../../Anforderungsblock';

/**
 * `/portal/[mandant]/security/posten/[id]` — ein Posten: verlangte Nachweise,
 * Mindestbesetzung, Abdeckung (SEC-01, SEC-04, TIM-04).
 *
 * **Die Anforderungen stehen hier — und werden hier eingetragen** (V-179).
 * Bis dahin stand an dieser Stelle „angelegt werden sie woanders", und ein
 * solches Woanders gab es nicht: für `einsatzanforderung` fehlten Dienst,
 * Route und Formular, und das SEC-04-Tor meldete ohne Zeile jede Einteilung
 * als erfüllt. Der KATALOG der Qualifikationen gehört weiter den Stammdaten
 * (`/stammdaten/qualifikationen`); was dieser Posten davon VERLANGT, trägt
 * die Sicherheitsleitung hier ein (`security.schreiben`, `Anforderungsblock`).
 *
 * **Der Veröffentlichungsknopf ist hier KEIN Knopf, sondern ein Befund.** Die
 * Freigabe eines Planungszeitraums an die Belegschaft ist
 * `dienstplan.veroeffentlichen` und gehört der Dienstplandomäne; was diese
 * Seite zeigt, ist das Ergebnis des Tors davor — mit denselben Zahlen, die
 * die Dringlichkeitsabfrage liefert.
 */
export const dynamic = 'force-dynamic';

const FENSTER_TAGE = 28;

interface PostenKopf {
  readonly id: string;
  readonly bezeichnung: string;
  readonly kurzzeichen: string | null;
  readonly objekt: string;
  readonly objekt_id: string;
  readonly art: string | null;
  readonly art_platzhalter: boolean | null;
  readonly min_besetzung: number;
  readonly soll_besetzung: number;
  readonly abdeckung_rrule: string | null;
  readonly dauer_minuten: number | null;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
}

interface Schicht {
  readonly id: string;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly soll_besetzung: number;
  readonly min_besetzung: number;
  readonly besetzt_anzahl: number;
}

export default async function PostenBlatt(
  {
    params, searchParams,
  }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/security/posten/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'dienstplan.lesen', 'security.schreiben');
  if (sitzung.aktiverMandantId === null) notFound();

  const heute = await berlinHeute();
  const bis = tagePlus(heute, FENSTER_TAGE);

  const daten = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const [kopf] = await kontext.abfrage<PostenKopf>(
          `select p.id, p.bezeichnung, p.kurzzeichen, o.bezeichnung as objekt, p.objekt_id,
                  pa.bezeichnung as art, pa.ist_platzhalter as art_platzhalter,
                  p.min_besetzung, p.soll_besetzung, p.abdeckung_rrule, p.dauer_minuten,
                  to_char(p.gueltig_ab, 'DD.MM.YYYY') as gueltig_ab,
                  to_char(p.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis
             from posten p
             join objekt o on o.id = p.objekt_id and o.mandant_id = p.mandant_id
             left join postenart pa on pa.id = p.postenart_id and pa.mandant_id = p.mandant_id
            where p.id = $1::uuid`,
          [id],
        );
        if (kopf === undefined) return null;

        /**
         * Die Anforderungen des Postens UND die des Objekts UND die
         * mandantenweite Grundlage — additiv, genau wie der Auflöser im Tor
         * sie liest (§9.2). Nur die Postenzeilen zu zeigen hiesse, eine
         * §34a-Grundanforderung zu verschweigen, die trotzdem greift.
         */
        const anforderungen = await leseAnforderungen(kontext, {
          art: 'posten', id, objektId: kopf.objekt_id,
        });
        const qualifikationen = darf['security.schreiben'] === true
          ? await waehlbareQualifikationen(kontext) : [];

        const schichten = await kontext.abfrage<Schicht>(
          `select e.id,
                  to_char(e.beginn_zeitpunkt at time zone 'Europe/Berlin',
                          'DD.MM.YYYY HH24:MI') as beginn_lokal,
                  to_char(e.ende_zeitpunkt at time zone 'Europe/Berlin',
                          'DD.MM. HH24:MI') as ende_lokal,
                  e.soll_besetzung, e.min_besetzung, e.besetzt_anzahl
             from einsatz e
            where e.posten_id = $1::uuid and e.storniert_am is null
              and e.beginn_zeitpunkt >= ($2::date)::timestamp at time zone 'Europe/Berlin'
              and e.beginn_zeitpunkt <  (($3::date) + 1)::timestamp at time zone 'Europe/Berlin'
            order by e.beginn_zeitpunkt`,
          [id, heute, bis],
        );

        /**
         * Das Tor selbst, aufgerufen wie der Veröffentlichungspfad es täte —
         * und sein Fehler als Befund gezeigt. Es hier nachzubauen („zähle die
         * Schichten mit besetzt < min") wäre eine zweite Fassung derselben
         * Regel, und die erste Abweichung fiele niemandem auf.
         */
        let veroeffentlichbar = true;
        let luecken = 0;
        try {
          await assertBesetzungVeroeffentlichbar(kontext, { von: heute, bis, postenId: id });
        } catch (fehler) {
          if (!(fehler instanceof PostenUnterbesetzt)) throw fehler;
          veroeffentlichbar = false;
          luecken = fehler.luecken.length;
        }

        return { kopf, anforderungen, qualifikationen, schichten, veroeffentlichbar, luecken };
      })) as Promise<{
        kopf: PostenKopf;
        anforderungen: readonly AnforderungZeile[];
        qualifikationen: readonly { readonly id: string; readonly bezeichnung: string }[];
        schichten: readonly Schicht[];
        veroeffentlichbar: boolean;
        luecken: number;
      } | null>);

  // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();
  const { kopf, anforderungen, qualifikationen, schichten, veroeffentlichbar, luecken } = daten;
  const tA = nachSprache(ANFORDERUNG_TEXTE, zugang.sprache);
  /* D-599/D-728: der Grund einer Abweisung kommt als Schlüssel aus der
     Adresse und wird nur als EIGENER Eintrag nachgeschlagen. */
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const erfolg = typeof suche['anforderung'] === 'string' ? suche['anforderung'] : null;
  const meldung = fehler !== null
    ? { art: 'warnung' as const, text: eigenerEintrag(tA.fehler, fehler) ?? tA.fehlerUnbekannt }
    : erfolg === 'angelegt' ? { art: 'erfolg' as const, text: tA.angelegt }
      : erfolg === 'archiviert' ? { art: 'erfolg' as const, text: tA.archiviert } : null;

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="security"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.bezeichnung}</h1>
        <Link
          href={`/portal/${mandant}/security/posten`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted
                     hover:border-line-strong hover:text-text"
        >
          Zur Postenliste
        </Link>
      </div>

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <p className="m-0 text-sm text-text-muted">
          {kopf.objekt}
          {kopf.kurzzeichen !== null && ` · ${kopf.kurzzeichen}`}
          {kopf.art !== null && ` · ${kopf.art}`}
          {/* Als WORT, nicht als Pille — das Pillenvokabular aus DESIGN §5
              kennt „Unbestätigter Wert" noch nicht (03-GEWERKE §2.3 Nr. 5). */}
          {kopf.art_platzhalter === true && (
            <span className="ml-s2 text-warning">· Art unbestätigt (O-148)</span>
          )}
        </p>
        <p className="m-0 mt-s2 text-sm tabular-nums text-text-muted">
          Soll {kopf.soll_besetzung} · Minimum {kopf.min_besetzung}
          {' · '}
          {kopf.abdeckung_rrule === null
            ? 'durchgehend besetzt'
            : `${kopf.abdeckung_rrule}${kopf.dauer_minuten === null ? '' : `, ${kopf.dauer_minuten} Minuten`}`}
        </p>
        <p className="m-0 mt-s2 text-sm tabular-nums text-text-muted">
          Gültig ab {kopf.gueltig_ab}
          {kopf.gueltig_bis === null ? ' · unbefristet' : ` bis ${kopf.gueltig_bis}`}
        </p>
      </section>

      <section data-cse="veroeffentlichung" className="mb-s6">
        <h2 className="mb-s2 text-h3 text-text">Veröffentlichung</h2>
        {veroeffentlichbar ? (
          <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-success">
            Besetzt — alle Schichten der nächsten {FENSTER_TAGE} Tage erreichen
            die Mindeststärke.
          </p>
        ) : (
          <p
            data-cse="nicht-veroeffentlichbar"
            className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-warning"
          >
            Nicht als besetzt veröffentlichbar: {luecken} Schicht(en) liegen unter
            der Mindestbesetzung. Die Einteilung muss geändert werden — für die
            Mindeststärke gibt es keinen Übergehen-Knopf, sie ist eine Zusage an
            den Auftraggeber.
          </p>
        )}
      </section>

      <Anforderungsblock
        texte={tA}
        anforderungen={anforderungen}
        qualifikationen={qualifikationen}
        herkunft={{ art: 'posten', id: kopf.id }}
        hatObjekt
        darfSchreiben={darf['security.schreiben'] === true}
        zurueck={pfad}
        meldung={meldung}
      />

      <section>
        <h2 className="mb-s2 text-h3 text-text">
          Abdeckung der nächsten {FENSTER_TAGE} Tage
        </h2>
        {schichten.length === 0 ? (
          <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Keine Schicht im Fenster. Der nächtliche Generator legt sie aus der
            Abdeckungsregel an, sobald der Posten gültig ist.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {schichten.map((s) => {
              const fehlt = s.besetzt_anzahl < s.min_besetzung;
              return (
                <li
                  key={s.id}
                  data-cse="postenschicht"
                  data-unterbesetzt={fehlt ? 'ja' : 'nein'}
                  className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3
                             border-b border-line pb-s2 text-sm last:border-0"
                >
                  {/*
                    * `/dienstplan/einsatz/[id]` verlangt laut Manifest
                    * `dienstplan.lesen`; diese Seite nur `security.lesen`. Ohne
                    * das erste führte die Schichtzeile auf 404 und verriete, was
                    * sie nicht zeigen darf (AUT-06; Copilot-Runde auf PR 16 /
                    * D-581) — dann steht die Zeit als blosser Text.
                    */}
                  {darf['dienstplan.lesen'] === true ? (
                    <Link
                      href={`/portal/${mandant}/dienstplan/einsatz/${s.id}`}
                      className="tabular-nums text-text underline-offset-2
                                 hover:text-brand hover:underline"
                    >
                      {s.beginn_lokal} – {s.ende_lokal}
                    </Link>
                  ) : (
                    <span className="tabular-nums text-text">
                      {s.beginn_lokal} – {s.ende_lokal}
                    </span>
                  )}
                  <span className={`tabular-nums ${fehlt ? 'text-warning' : 'text-text-muted'}`}>
                    {s.besetzt_anzahl} von {s.soll_besetzung} besetzt
                    {fehlt && ` · Minimum ${s.min_besetzung} nicht erreicht`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PortalRahmen>
  );
}
