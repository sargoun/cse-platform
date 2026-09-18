import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import {
  dateigroesse, dateityp, DOKUMENTE_ERREICHBAR, findeKundendokument,
  KATEGORIE_LABEL, SIGNATUR_MINUTEN,
} from '@/server/services/kundenportal/dokument';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { kundePortal, KundenRahmen } from '../../rahmen';
import {
  Feld, Felder, Gesellschaft, KeinZugang, Kopfzeile, Offen, Zurueck,
} from '../../bausteine';

/**
 * `/portal/kunde/dokumente/[id]` — das Blatt zu einer freigegebenen Unterlage
 * (DOC-01, DOC-03, DOC-04, SEC-A6, AUT-06).
 *
 * ===========================================================================
 * Es gibt KEINE Datei-Adresse auf dieser Seite, und zwar aus zwei Gruenden
 * ===========================================================================
 *
 * **1. Es gibt nichts zu holen (O-671).** `dokument` traegt im Kunden-Scope
 * keine permissive Policy; die Abfrage liefert heute `null`, und die Seite
 * antwortet `notFound()`. Ein Knopf waere ein Knopf vor einem 404.
 *
 * **2. Selbst wenn es etwas zu holen gaebe, fehlte die Spur (O-843).** DOC-03
 * und SEC-A6 verlangen, dass eine Datei ausschliesslich ueber eine
 * kurzlebige signierte Adresse herausgeht — `SIGNATUR_SEKUNDEN` = 15 Minuten,
 * eine Codekonstante, keine Umgebungsvariable. Und die gebaute interne Route
 * (`/api/dokumente/[id]/datei`) schreibt VOR der Adresse eine Zeile nach
 * `dokument_zugriff`, in derselben Transaktion: kein Abruf ohne Vermerk, sonst
 * ist er fuer die Datenschutzauskunft unsichtbar (Art. 15 DSGVO).
 *
 * Genau das kann eine Kundensitzung heute nicht: `t_dokument_zugriff_anlegen`
 * (0139) verlangt `mandant_id = app.aktiver_mandant()`, und der ist im
 * Kunden-Scope NULL (K-20); ausserdem ist der Scope `app.ist_readonly()`.
 * Nachgemessen, nicht vermutet. Der Weg dafuer ist ein `security definer`
 * (dieselbe Bauart wie `drizzle/0266` und `0325`) — und er gehoert in
 * DIESELBE Migration wie die Antwort auf O-671, sonst liefert das Portal
 * Dateien aus, die niemand vermerkt hat.
 *
 * Ein Abrufweg, der heute gebaut wuerde, waere deshalb entweder ohne Spur
 * (unzulaessig) oder ohne Wirkung (404 auf jede Kennung). Die Seite sagt
 * stattdessen, was offen ist und wie die Unterlage heute kommt.
 *
 * ===========================================================================
 * Was das Blatt zeigt
 * ===========================================================================
 *
 * Titel, Beschreibung, Kategorie, Dateityp, Groesse, Fassung, Objektbezug,
 * Ablagezeitpunkt in Berliner Ortszeit und die liefernde Gesellschaft. Nicht:
 * Ablageort (`bucket`, `objekt_schluessel`), Aufbewahrungsfrist,
 * Loeschsperre, Mitarbeitersichtbarkeit, Akteure — die Begruendung je Spalte
 * steht im Dienst.
 *
 * **Ein fremdes Dokument gibt 404, nie 403** (AUT-06, SEC-A3) — und heute
 * gibt JEDE Kennung 404, aus demselben Code-Pfad. Das ist kein Sonderfall,
 * den jemand pflegen muss: faellt die Entscheidung zu O-671, unterscheidet
 * dieselbe Zeile wieder zwischen eigen und fremd.
 */
export const dynamic = 'force-dynamic';

export default async function Kundendokument(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roh } = await params;
  const id = kennungOder404(roh);

  const ergebnis = await kundePortal(`/portal/kunde/dokumente/${id}`,
    async (kontext) => findeKundendokument(kontext, id));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Dokument" aktiverTab="dokumente">
        <Kopfzeile titel="Dokument" />
        <KeinZugang />
      </KundenRahmen>
    );
  }
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const d = ergebnis.daten;

  return (
    <KundenRahmen basis={basis} titel={d.titel} aktiverTab="dokumente">
      <Zurueck ziel="/portal/kunde/dokumente" text="Alle Dokumente" />

      <Kopfzeile titel={d.titel}>
        <span data-cse="kategorie" data-kategorie={d.kategorie} className="text-sm text-text-muted">
          {KATEGORIE_LABEL[d.kategorie] ?? d.kategorie}
        </span>
      </Kopfzeile>

      <Card className="mb-s5">
        <Felder>
          <Feld label="Gesellschaft">
            <Gesellschaft slug={d.mandantSlug} name={d.mandantName} />
          </Feld>
          <Feld label="Kategorie">{KATEGORIE_LABEL[d.kategorie] ?? d.kategorie}</Feld>
          <Feld label="Dateityp">{dateityp(d.mimeTyp)}</Feld>
          <Feld label="Größe">
            <span className="cse-zahl">{dateigroesse(d.groesseBytes)}</span>
          </Feld>
          {d.version !== null && (
            <Feld label="Fassung">
              <span className="cse-zahl">{d.version}</span>
            </Feld>
          )}
          {d.objektBezeichnung !== null && (
            <Feld label="Objekt">{d.objektBezeichnung}</Feld>
          )}
          <Feld label="Abgelegt am (Berlin)">
            <span className="cse-zahl">{d.abgelegtAmLokal}</span>
          </Feld>
        </Felder>

        {d.beschreibung === null ? null : (
          <p className="mt-s5 mb-0 max-w-prose whitespace-pre-line text-base text-text">
            {d.beschreibung}
          </p>
        )}
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Herunterladen</h2>
      {DOKUMENTE_ERREICHBAR ? (
        /*
         * Der Platz für den Abruf. Er entsteht mit der Migration zu O-671 und
         * O-843 — und dann als Verweis auf eine Route, die die Spur schreibt
         * und danach auf eine signierte Adresse weiterleitet. Eine Datei geht
         * NIE über einen Pfad hinaus; einen öffentlichen Bucket kennt dieses
         * Schema nicht (DOC-03).
         */
        <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Der Abruf erzeugt eine Adresse, die nach {SIGNATUR_MINUTEN} Minuten
          verfällt.
        </p>
      ) : (
        <div className="flex flex-col gap-s4">
          <Offen
            nummer="O-671"
            was="Diese Unterlage kommt nicht über das Portal"
            weg={`Ob freigegebene Dokumente hier herunterladbar sind, ist noch
              nicht entschieden. Ausgeliefert würde eine Datei ausschließlich
              über eine Adresse, die nach ${String(SIGNATUR_MINUTEN)} Minuten
              verfällt — einen dauerhaften Pfad gibt es nicht. Ihre
              Ansprechpartnerin schickt Ihnen die Unterlage auf dem bisherigen
              Weg.`}
          />
        </div>
      )}
    </KundenRahmen>
  );
}
