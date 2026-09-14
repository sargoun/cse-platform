import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/buchhaltung/bank/import` — den Auszug hochladen
 * (ACC-04).
 *
 * **Die Seite sagt, was danach passiert, BEVOR man hochlädt.** Wer eine Datei
 * in ein Formular gibt, ohne zu wissen, ob danach Zahlungen gebucht werden,
 * lädt sie beim ersten Mal zögerlich und beim zweiten gar nicht. Hier steht
 * die Regel: nur ein Treffer aus Betrag UND Nummer UND IBAN wird
 * zugeordnet, alles andere wartet auf einen Menschen.
 *
 * **Und was NICHT passiert:** es gibt keinen Abruf bei der Bank und keine
 * ausgehende SEPA-Datei.
 */
export const dynamic = 'force-dynamic';

export default async function BankImport(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/buchhaltung/bank/import`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const knopf = 'min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Auszug einlesen"
      wurzelTitel="Bank"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bank"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Kontoauszug einlesen</h1>
        <Link href={`/portal/${mandant}/buchhaltung/bank`} className={knopf}>
          Zurück
        </Link>
      </div>

      <section className="mb-s5 rounded-lg border border-line bg-surface p-s5">
        <h2 className="text-h3 text-text">Was danach passiert</h2>
        <ul className="mt-s3 flex list-disc flex-col gap-s2 pl-s5 text-sm text-text-muted">
          <li>
            Jede Zeile des Auszugs wird gespeichert — auch die, zu der keine
            Rechnung passt. Ein Umsatz verschwindet nie aus der Ansicht.
          </li>
          <li>
            <strong className="text-text">Zugeordnet wird nur ein eindeutiger
            Treffer:</strong> Betrag UND Rechnungsnummer im Verwendungszweck
            UND die IBAN, von der derselbe Kunde zuletzt gezahlt hat. Alles
            darunter wartet auf eine Entscheidung.
          </li>
          <li>
            Eine Vormerkung der Bank (<span className="font-mono">PDNG</span>)
            wird nicht zugeordnet — der Betrag kann sich noch ändern.
          </li>
          <li>
            Dieselbe Datei ein zweites Mal einzulesen fügt nichts hinzu. Der
            Prüfwert der Datei entscheidet, nicht die Auszugsnummer.
          </li>
        </ul>
      </section>

      <form
        method="post"
        action="/api/buchhaltung/bank"
        encType="multipart/form-data"
        className="rounded-lg border border-line bg-surface p-s5"
      >
        <div className="flex flex-col gap-s2">
          <label className="text-sm text-text" htmlFor="datei">
            CAMT.053-Datei (XML)
          </label>
          <input
            id="datei" name="datei" type="file" accept=".xml,text/xml,application/xml"
            required
            className="min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />
          <p className="text-xs text-text-subtle">
            Aus dem Onlinebanking: „Umsätze exportieren" → CAMT.053. Die Datei
            wird archiviert und bleibt zehn Jahre lesbar.
          </p>
        </div>
        <button type="submit" className={`${knopf} mt-s5`} data-cse="bank-einlesen">
          Einlesen
        </button>
      </form>

      <p className="mt-s5 text-sm text-text-muted">
        Die Plattform ruft keine Umsätze ab und sendet keine Zahlungen: kein
        PSD2, kein FinTS, keine Zugangsdaten. Sie liest, was Sie ihr geben.
      </p>
    </PortalRahmen>
  );
}
