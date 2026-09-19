import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { findeKundenreklamation } from '@/server/services/kundenportal/reklamation';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { kundePortal, KundenRahmen } from '../../rahmen';
import {
  Feld, Felder, Gesellschaft, KeinZugang, Kopfzeile, Offen, Zurueck,
} from '../../bausteine';

/**
 * `/portal/kunde/reklamationen/[id]` — eine Beanstandung im Einzelnen
 * (OPS-11, AUT-06, SEC-A3).
 *
 * **Eine fremde Reklamation gibt 404, nie 403.** `t_kunde` und
 * `p_portal_decke` auf `reklamation` binden die Zeile an
 * `kunde_id = any (app.aktuelle_kunden())`; eine fremde faellt auf null
 * Zeilen, und die Seite antwortet byte-gleich mit „gibt es nicht".
 *
 * **Der Verlauf (`reklamation_abstellung`) wird nicht gezeigt.** Er ist der
 * interne Vorgang: wer wann welchen Zustand gesetzt hat, mit den Vermerken
 * dazwischen. Was davon zum Kunden gehoert, ist nicht entschieden, und die
 * konservative Antwort ist der aktuelle Zustand plus die Massnahme.
 *
 * **`ursache` steht hier nicht** — dieselbe Begruendung wie in der Liste.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  behoben: 'Bereit',
  abgelehnt: 'Abgelehnt',
  geschlossen: 'Abgeschlossen',
};

const PRIORITAET: Readonly<Record<string, string>> = {
  niedrig: 'niedrig', mittel: 'mittel', hoch: 'hoch',
};

export default async function Kundenreklamation(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roh } = await params;
  const id = kennungOder404(roh);

  const ergebnis = await kundePortal(`/portal/kunde/reklamationen/${id}`,
    async (kontext) => findeKundenreklamation(kontext, id),
    /*
     * AUT-06: der Verweis auf den bestrittenen Nachweis fuehrt nach
     * `/portal/kunde/nachweise`, und die Route verlangt laut Manifest
     * `nachweis.lesen` (und `bau.lesen`). Wer sie nicht haelt, sah den
     * Verweis und bekam dahinter ein 404.
     */
    ['nachweis.lesen', 'bau.lesen']);

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Reklamation" aktiverTab="reklamationen">
        <Kopfzeile titel="Reklamation" />
        <KeinZugang />
      </KundenRahmen>
    );
  }
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const r = ergebnis.daten;
  const darfNachweis = basis.rechte['nachweis.lesen'] === true
    && basis.rechte['bau.lesen'] === true;

  return (
    <KundenRahmen basis={basis} titel={r.nummer} aktiverTab="reklamationen">
      <Zurueck ziel="/portal/kunde/reklamationen" text="Alle Reklamationen" />

      <Kopfzeile titel={r.nummer}>
        <StatusPill zustand={PILLE[r.status] ?? 'Offen'} />
      </Kopfzeile>

      <Card className="mb-s5">
        <Felder>
          <Feld label="Gesellschaft">
            <Gesellschaft slug={r.mandantSlug} name={r.mandantName} />
          </Feld>
          <Feld label="Objekt">{r.objekt ?? '—'}</Feld>
          <Feld label="Eingang (Berlin)">
            <span className="cse-zahl">{r.eingangAmLokal}</span>
          </Feld>
          <Feld label="Frist">
            {r.faelligAmLokal === null
              ? <span className="text-text-subtle">offen (O-14)</span>
              : <span className="cse-zahl">{r.faelligAmLokal}</span>}
          </Feld>
          <Feld label="Priorität">{PRIORITAET[r.prioritaet] ?? r.prioritaet}</Feld>
          <Feld label="Nacharbeit">
            {r.nacharbeitDatumLokal === null
              ? <span className="text-text-subtle">noch kein Termin hinterlegt</span>
              : <span className="cse-zahl">{r.nacharbeitDatumLokal}</span>}
          </Feld>
        </Felder>

        <p className="mt-s5 mb-0 max-w-prose whitespace-pre-line text-base text-text">
          {r.beschreibung}
        </p>
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Was wir getan haben</h2>
      <Card className="mb-s5">
        {r.massnahme === null ? (
          <p className="m-0 max-w-prose text-base text-text-muted">
            Es ist noch keine Maßnahme vermerkt. Ein Vorgang gilt erst als
            behoben, wenn aufgeschrieben ist, was getan wurde — deshalb steht
            hier nichts statt einer Zwischenmeldung.
          </p>
        ) : (
          <p className="m-0 max-w-prose whitespace-pre-line text-base text-text">
            {r.massnahme}
          </p>
        )}
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Bestrittener Nachweis</h2>
      <Card className="mb-s5">
        <p className="m-0 text-base text-text">
          {r.leistungsnachweisId === null ? (
            <span className="text-text-muted">
              Diese Beanstandung ist keinem Leistungsnachweis zugeordnet.
            </span>
          ) : darfNachweis ? (
            <Link
              href="/portal/kunde/nachweise"
              className="text-text underline underline-offset-2 hover:text-brand"
            >
              {r.leistungsnachweisNummer ?? 'Nachweise öffnen'}
            </Link>
          ) : (
            r.leistungsnachweisNummer ?? '—'
          )}
        </p>
      </Card>

      <div className="flex flex-col gap-s4">
        <Offen
          nummer="O-74"
          was="Nachfassen und Erledigung bestätigen läuft über Ihre Ansprechpartnerin"
          weg="Eine Bestätigung durch Sie ist rechtlich die Abnahme der
            Nacharbeit; ob sie im Portal erklärt werden kann, ist noch nicht
            entschieden."
        />
      </div>
    </KundenRahmen>
  );
}
