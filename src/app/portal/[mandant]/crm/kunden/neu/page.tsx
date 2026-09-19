import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/crm/kunden/neu` — einen Kunden anlegen (CRM-01, OPS-01).
 *
 * **Die Rechtsgrundlage steht nicht am Ende des Formulars, sondern in der
 * Mitte, mit einer Erklärung.** Sie ist das Feld, aus dem
 * `app.darf_kontaktiert_werden` seine Antwort zieht — und die entscheidet, ob
 * eine Werbenachricht an diesen Kunden hinausgeht oder abgewiesen wird (§7 UWG,
 * LEG-08). Sie als letztes Pflichtfeld unter „Sonstiges" zu führen hiesse, dass
 * sie jemand wegklickt.
 *
 * **Die Vorgabe ist „keine", und das ist der sichere Zweig.** Ein Kunde ohne
 * Grundlage steht in der Liste, lässt sich bebuchen und berechnen — und
 * bekommt keine Werbung. Wer die Grundlage kennt, trägt sie ein; wer sie nicht
 * kennt, soll nicht raten.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Neuer Kunde — CRM' };

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export default async function KundeNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/crm/kunden/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'crm.schreiben', 'crm.lesen');
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  return (
    <PortalRahmen
      titel="Neuer Kunde"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['crm.lesen'] === true && (
        <p className="mb-s3 text-sm">
          <Link href={`/portal/${mandant}/crm/kunden`}
                className="text-text-muted underline-offset-2 hover:underline">
            ← Kunden
          </Link>
        </p>
      )}
      <h1 className="mb-s5 mt-0 text-h1 text-text">Neuer Kunde</h1>

      {meldung !== null && (
        <Hinweis art="warnung" cse="kunde-meldung" className="mb-s5 max-w-prose">
          {meldung}
        </Hinweis>
      )}

      {darf['crm.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          Zum Anlegen fehlt Ihnen <code className="font-mono">crm.schreiben</code>.
        </Hinweis>
      ) : (
        <form method="post" action="/api/crm/kunde" data-cse="kunde-formular"
              className="flex max-w-[56ch] flex-col gap-s5">
          <input type="hidden" name="zurueck" value={pfad} />

          <Card>
            <h2 className="mb-s4 mt-0 text-h3 text-text">Wer</h2>
            <div className="flex flex-col gap-s4">
              <label className="flex flex-col gap-s2 text-sm text-text">
                Name
                <input name="name" required className={FELD} data-cse="kunde-name" />
              </label>
              <fieldset className="m-0 flex flex-wrap gap-s4 border-0 p-0">
                <legend className="mb-s2 p-0 text-sm text-text">Art</legend>
                {([['firma', 'Firma'], ['behoerde', 'Behörde'], ['privat', 'Privat']] as const)
                  .map(([wert, text], i) => (
                    <label key={wert} className="flex items-center gap-s2 text-sm text-text">
                      <input type="radio" name="typ" value={wert} required
                             defaultChecked={i === 0} data-cse="kunde-typ" />
                      {text}
                    </label>
                  ))}
              </fieldset>
              <p className="m-0 text-xs text-text-muted">
                „Behörde" setzt <code className="font-mono">ist_oeffentlicher_auftraggeber</code>
                {' '}— davon hängt ab, ob eine Rechnung als XRechnung gestellt werden muss.
              </p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-s4 mt-0 text-h3 text-text">Wo</h2>
            <div className="flex flex-col gap-s4">
              <div className="flex gap-s3">
                <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                  Strasse
                  <input name="strasse" className={FELD} autoComplete="address-line1" />
                </label>
                <label className="flex w-24 flex-col gap-s2 text-sm text-text">
                  Nr.
                  <input name="hausnummer" className={FELD} />
                </label>
              </div>
              <div className="flex gap-s3">
                <label className="flex w-28 flex-col gap-s2 text-sm text-text">
                  PLZ
                  <input name="plz" className={FELD} autoComplete="postal-code" />
                </label>
                <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                  Ort
                  <input name="ort" className={FELD} autoComplete="address-level2" />
                </label>
              </div>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Zentrale E-Mail
                <input name="emailZentral" type="email" className={FELD} />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Zentrales Telefon
                <input name="telefonZentral" className={FELD} autoComplete="tel" />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                USt-IdNr.
                <input name="ustId" className={FELD} />
              </label>
            </div>
          </Card>

          <Card>
            <h2 className="mb-s3 mt-0 text-h3 text-text">Dürfen wir werben?</h2>
            <p className="mb-s4 mt-0 text-sm text-text-muted">
              Aus diesem Feld zieht die Plattform ihre Antwort auf die Frage, ob eine
              Werbenachricht an diesen Kunden hinausgehen darf (§7 UWG). Es ist kein
              Formular-Kleingedrucktes: <strong>ohne Grundlage geht keine Werbung
              hinaus</strong> — Rechnungen, Leistungsnachweise und Terminbestätigungen
              schon.
            </p>
            <div className="flex flex-col gap-s3">
              {([
                ['keine', 'Keine — wir wissen es nicht (Vorgabe)'],
                ['bestandskunde', 'Bestandskunde — es besteht eine Geschäftsbeziehung'],
                ['anfrage', 'Anfrage — er hat von sich aus angefragt'],
                ['einwilligung', 'Einwilligung — er hat ausdrücklich zugestimmt'],
              ] as const).map(([wert, text], i) => (
                <label key={wert} className="flex items-center gap-s2 text-sm text-text">
                  <input type="radio" name="rechtsgrundlage" value={wert} required
                         defaultChecked={i === 0} data-cse="kunde-grundlage" />
                  {text}
                </label>
              ))}
              <label className="flex flex-col gap-s2 text-sm text-text">
                Woher stammt sie?
                <input name="grundlageQuelle" className={FELD}
                       placeholder="z. B. Häkchen im Angebotsformular vom 12.03." />
                <span className="text-xs text-text-muted">
                  Pflicht, sobald es nicht „keine" ist. Eine Einwilligung, von der
                  niemand sagen kann, wann und wo sie erteilt wurde, ist in einer
                  Abmahnung nichts wert.
                </span>
              </label>
            </div>
          </Card>

          <Button type="submit" variante="primary" className="self-start"
                  data-cse="kunde-anlegen">
            Kunde anlegen
          </Button>
        </form>
      )}
    </PortalRahmen>
  );
}
