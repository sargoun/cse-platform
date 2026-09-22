import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { ABWESENHEIT_AUFNAHME_TEXTE } from '@/lib/i18n/verwaltung/personal';
import {
  AbwesenheitAufnahmeFormular,
  type AnstellungAuswahl, type ArtAuswahl,
} from '../AufnahmeFormular';

/**
 * `/portal/[mandant]/personal/abwesenheiten/erfassen` — die Krankmeldung am
 * Telefon um 05:40 (V-025, EMP-09).
 *
 * **Der Befund stand im Dienst selbst.** `meldeAbwesenheit` trägt im Kopf
 * wörtlich „der Weg der Planung (die Krankmeldung am Telefon um 05:40)" — und
 * hatte genau einen Aufrufer: `/api/mein/abwesenheit`, die Route der
 * Arbeiterin. Die Verwaltung konnte genehmigen, ablehnen und stornieren; was
 * sie nicht konnte, war das, was sie morgens tatsächlich tut.
 *
 * **Weder Recht noch Policy fehlten.** `t_mandant_schreiben` auf `abwesenheit`
 * verlangt `zeit.abwesenheit_melden`, und das hält `admin` wie `leitung` seit
 * `0073`. Gefehlt hat der Weg dorthin — derselbe Befundtyp wie V-031.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'zeit.abwesenheit_melden';


export const metadata = { title: 'Abwesenheit aufnehmen' };

export default async function AbwesenheitErfassen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/abwesenheiten/erfassen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(ABWESENHEIT_AUFNAHME_TEXTE, zugang.sprache);

  /*
   * **Das Recht der LISTE kommt mit, ausgeschrieben.**
   *
   * Aufnehmen und Lesen sind zwei Rechte, und sie fallen auseinander: wer nur
   * `zeit.abwesenheit_melden` haelt, darf die Krankmeldung entgegennehmen und
   * nicht die Abwesenheiten aller ansehen. Der Rueckweg steht deshalb nur,
   * wenn sein Ziel offen ist — ein Verweis auf 404 verriete die Existenz
   * dessen, was er nicht zeigen darf (AUT-06).
   *
   * Der Schluessel steht hier als Zeichenkette und nicht als Konstante:
   * `tests/kern/verweis-rechte.test.ts` liest den Seitenquelltext und sucht
   * das Recht des ZIELS darin. Eine Konstante verbaerge es vor genau der
   * Vermessung, die diesen Befund gefunden hat.
   */
  const darf = await haeltRechte(
    zugang.sitzung, RECHT, 'zeit.abwesenheit_lesen');
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      /*
       * Die Anstellungen dieser Gesellschaft — nicht die Personen. Der
       * zusammengesetzte Fremdschlüssel `ab_anstellung_fk (mandant_id,
       * anstellung_id)` lässt ohnehin keine andere zu; die Liste zeigt
       * deshalb genau das, was auch gespeichert werden kann.
       */
      const anstellungen = await kontext.abfrage<AnstellungAuswahl>(
        `select a.id, (p.nachname || ', ' || p.vorname) as name
           from anstellung a join person p on p.id = a.person_id
          where a.geloescht_am is null and a.status = 'aktiv'
          order by p.nachname, p.vorname limit 500`);
      /*
       * Die Arten der Gesellschaft UND die gruppenweiten (`mandant_id is
       * null`). Ohne die zweiten sähe eine Gesellschaft, die keine eigenen
       * angelegt hat, eine leere Liste — und „keine Abwesenheitsart" ist eine
       * andere Aussage als „nur die gemeinsamen".
       */
      /*
       * **`bezahlt is not null` kommt MIT.** `pruefeArt` weist eine Art ab,
       * bei der nicht hinterlegt ist, ob sie bezahlt ist (O-139) — zu Recht:
       * eine erfundene Lohnregel faellt erst in der Abrechnung auf. Ohne
       * diese Spalte hier fuellte die Aufnehmende das ganze Formular aus und
       * liefe beim Absenden in genau diesen Satz. Die Liste sagt es vorher.
       */
      const arten = await kontext.abfrage<ArtAuswahl>(
        `select id, bezeichnung, (bezahlt is not null) as geklaert
           from abwesenheitsart
          where archiviert_am is null
            and (mandant_id is null or mandant_id = app.aktiver_mandant())
          order by (bezahlt is null), bezeichnung limit 200`);
      return { anstellungen, arten };
    })) as Promise<{
      anstellungen: readonly AnstellungAuswahl[]; arten: readonly ArtAuswahl[];
    }>);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['zeit.abwesenheit_lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/personal/abwesenheiten`, text: t.modul } }
        : {})}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <Hinweis art="hinweis" cse="warum-aufnehmen" className="mb-s5 max-w-prose">
        {t.warumErklaerung}
      </Hinweis>

      {fehler === 'ueberlappt' && (
        <Hinweis art="warnung" cse="abwesenheit-ueberlappt" className="mb-s5 max-w-prose">
          {t.ueberlappt}
        </Hinweis>
      )}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht}{' '}
          <code className="font-mono">{RECHT}</code>.
        </Hinweis>
      ) : daten.anstellungen.length === 0 ? (
        <Hinweis art="warnung" cse="keine-anstellung" className="max-w-prose">
          {t.keineAnstellung}
        </Hinweis>
      ) : daten.arten.every((a) => !a.geklaert) ? (
        <Hinweis art="warnung" cse="keine-geklaerte-art" className="max-w-prose">
          {t.keineGeklaerteArt}
        </Hinweis>
      ) : (
        <AbwesenheitAufnahmeFormular
          zurueck={darf['zeit.abwesenheit_lesen'] === true
            ? `/portal/${mandant}/personal/abwesenheiten`
            : pfad}
          fehlerweg={pfad}
          anstellungen={daten.anstellungen}
          arten={daten.arten}
          t={t}
        />
      )}
    </PortalRahmen>
  );
}
