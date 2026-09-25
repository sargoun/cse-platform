import Link from 'next/link';
import { Geraetezeit } from '@/app/portal/mein/Geraetezeit';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mitLesekontext } from '../../../daten';
import { bereiteUnterschriftVor } from '@/server/services/reinigung/leistungsnachweis';
import type { SchnappschussPosition } from '@/server/services/reinigung/schnappschuss';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/reinigung/leistungsnachweise/[id]/unterschrift` — der
 * Bildschirm, den der Kunde vor Ort sieht (CLN-04, TIM-08, LEG-10).
 *
 * **Die Prüfsumme reist mit und wird beim Abschicken verglichen.** Sie ist der
 * Digest genau der Zeilen, die hier stehen. Ändert das Büro in der Zwischenzeit
 * eine Zeile, weist der Dienst die Unterschrift ab, statt ein Dokument zu
 * erzeugen, das der Kunde so nie gesehen hat.
 *
 * **Die Gerätezeit füllt der Browser, die Serverzeit der Server.** Das Feld
 * unten ist eine BEHAUPTUNG des Tablets und wird getrennt gespeichert; welche
 * Zeit im Dokument steht, entscheidet `now()` in der Datenbank (Invariante 5).
 * Ohne JavaScript bleibt es leer — und die Unterschrift gelingt trotzdem, weil
 * die Gerätezeit nie das Tragende war.
 *
 * **Kein Canvas ohne Speicher.** Das Unterschriftsbild ist die Beigabe, nicht
 * der Beweis: Name, Serverzeit und Abzug tragen den Vorgang. Ist der
 * Bildspeicher nicht verbunden, sagt die Seite es und lässt unterschreiben,
 * statt einen Erfolg vorzutäuschen (CLAUDE.md: keine Schein-Integrationen).
 */
export const dynamic = 'force-dynamic';

function cent(text: string | null): string {
  if (text === null) return '—';
  const roh = text.startsWith('-') ? text.slice(1) : text;
  const ganz = roh.length > 2 ? roh.slice(0, -2) : '0';
  const rest = roh.padStart(3, '0').slice(-2);
  return `${text.startsWith('-') ? '-' : ''}${ganz},${rest} €`;
}

export default async function Unterschriftsblatt({
  params,
}: {
  params: Promise<{ mandant: string; id: string }>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(
    `/portal/${mandant}/reinigung/leistungsnachweise/${id}/unterschrift`,
  );
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: der Nachweis `…/leistungsnachweise/[id]` verlangt laut Manifest
     `nachweis.lesen`, dieses Blatt nur `nachweis.schreiben` — wer nur
     unterschreiben lassen darf, sah „Zum Nachweis" und „Abbrechen" und bekam
     dahinter ein 404. Ein Verweis auf 404 verraet, was er nicht zeigen darf
     (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'nachweis.lesen');

  const vorschau = await mitLesekontext(sitzung, async (k) =>
    bereiteUnterschriftVor(k, id).catch(() => null));
  if (vorschau === null) notFound();

  /*
   * **Die Gegenzeichnung des AUFTRAGNEHMERS** (V-094, CLN-04). `signiere`
   * kennt beide Rollen, `POST /api/reinigung/leistungsnachweise` liest
   * `rolle` und `anstellung` — und dieses Formular schickte
   * `value="auftraggeber"` fest verdrahtet. Die Unterschrift der eigenen
   * Objektleitung, die `leistungsnachweis_signatur` mit
   * `lns_auftragnehmer_hat_anstellung` eigens vorsieht und die die
   * Kundenansicht anzeigt, konnte nie entstehen.
   *
   * `anstellung_id` ist bei `auftragnehmer` PFLICHT (0066): der Auftragnehmer
   * sind wir, und wir unterschreiben mit einer Beschäftigung — der
   * Auftraggeber hat keine bei uns (D-09).
   */
  const anstellungen = await mitLesekontext(sitzung, async (k) =>
    k.abfrage<{ id: string; name: string }>(
      `select a.id, btrim(p.vorname || ' ' || p.nachname) as name
         from anstellung a
         join person p on p.id = a.person_id
        where a.mandant_id = app.aktiver_mandant()
          and a.geloescht_am is null and a.status = 'aktiv'
        order by p.nachname, p.vorname limit 300`));

  const bereit = vorschau.kopf.status === 'vorgelegt';

  return (
    <PortalRahmen
      titel="Unterschrift"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['nachweis.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/reinigung/leistungsnachweise/${id}`, text: 'Zum Nachweis' } }
        : {})}
    >
      <h1 className="mb-s3 text-h1 text-text">
        Leistungsnachweis {vorschau.kopf.nummer ?? ''}
      </h1>
      <p className="mb-s5 text-sm text-text-muted">
        {vorschau.kopf.kunde} · {vorschau.kopf.objekt ?? '—'} ·{' '}
        <span className="tabular-nums">
          {vorschau.kopf.leistungszeitraumVon} – {vorschau.kopf.leistungszeitraumBis}
        </span>
      </p>

      {!bereit && (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s4 text-sm text-danger">
          <Icon name="warnung" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
          Dieser Nachweis steht auf „{vorschau.kopf.status}". Unterschrieben wird
          nur, was vorgelegt ist.
        </p>
      )}

      <DataTable<SchnappschussPosition>
        beschriftung="Positionen, die unterschrieben werden"
        zeilen={vorschau.positionen}
        schluessel={(p) => p.reihenfolge}
        spalten={[
          { schluessel: 'bezeichnung', kopf: 'Leistung', zelle: (p) => p.bezeichnung },
          {
            schluessel: 'menge',
            kopf: 'Menge',
            numerisch: true,
            zelle: (p) => p.menge.replace('.', ','),
          },
          { schluessel: 'einheit', kopf: 'Einheit', zelle: (p) => p.einheit },
          {
            schluessel: 'preis',
            kopf: 'Einzelpreis',
            numerisch: true,
            zelle: (p) => cent(p.einzelpreisCent),
          },
        ]}
      />

      <form
        method="post"
        action="/api/reinigung/leistungsnachweise"
        className="mt-s5 rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />
        <input type="hidden" name="nachweis" value={id} />
        {/*
          **Die Rolle war fest verdrahtet** (V-094). Sie ist jetzt eine Wahl —
          und die Vorgabe bleibt der Auftraggeber: das ist der Bildschirm, den
          der Kunde vor Ort sieht, und der Regelfall.
        */}
        <div className="mb-s4">
          <label htmlFor="rolle" className="mb-s2 block text-sm text-text">
            Wer unterschreibt
          </label>
          <select
            id="rolle"
            name="rolle"
            defaultValue="auftraggeber"
            data-cse="unterschrift-rolle"
            className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
          >
            <option value="auftraggeber">Auftraggeber (Kunde) — er erkennt die Leistung an</option>
            <option value="auftragnehmer">Auftragnehmer (wir) — Gegenzeichnung der Objektleitung</option>
          </select>
          <p className="m-0 mt-s2 max-w-prose text-sm text-text-muted">
            Je Rolle genau eine Unterschrift. Die Gegenzeichnung des Auftragnehmers
            ersetzt die des Kunden nicht — sie steht daneben.
          </p>
        </div>

        <div className="mb-s4">
          <label htmlFor="anstellung" className="mb-s2 block text-sm text-text">
            Beschäftigung des Unterzeichners (nur beim Auftragnehmer)
          </label>
          <select
            id="anstellung"
            name="anstellung"
            defaultValue=""
            data-cse="unterschrift-anstellung"
            className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
          >
            <option value="">— keine (Auftraggeber) —</option>
            {anstellungen.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <p className="m-0 mt-s2 max-w-prose text-sm text-text-muted">
            Pflicht bei der Gegenzeichnung: der Auftragnehmer sind wir, und wir
            unterschreiben mit einer Beschäftigung — der Auftraggeber hat keine bei uns
            (D-09).
          </p>
        </div>
        {/* Der Digest genau dieser Zeilen. Ohne ihn wird nicht unterschrieben. */}
        <input type="hidden" name="pruefsumme" value={vorschau.pruefsumme} />
        <input
          type="hidden"
          name="zurueck"
          value={`/portal/${mandant}/reinigung/leistungsnachweise/${id}`}
        />
        {/*
          Die Behauptung des Geräts. Sie bleibt leer, wenn kein Skript läuft —
          und das ist in Ordnung: maßgeblich ist ohnehin die Serverzeit.
        */}
        <Geraetezeit marke="geraetezeit" />

        <p className="mb-s4 max-w-prose text-base text-text">
          {vorschau.bestaetigungstext}
        </p>

        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <div>
            <label htmlFor="unterzeichner" className="mb-s2 block text-sm text-text">
              Name der unterzeichnenden Person
            </label>
            <input
              id="unterzeichner"
              name="unterzeichner"
              required
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="funktion" className="mb-s2 block text-sm text-text">
              Funktion (optional)
            </label>
            <input
              id="funktion"
              name="funktion"
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
        </div>

        <p className="mt-s4 text-sm text-text-muted">
          <Icon name="uhr" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
          Zeitpunkt und Ort werden vom Server festgehalten. Die Uhrzeit des
          Geräts wird — falls übermittelt — daneben gespeichert, nie an ihrer
          Stelle.
        </p>
        <p className="mt-s2 text-sm text-text-muted">
          <Icon name="stift" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
          Unterschriftsbild: <strong className="text-warning">nicht verbunden</strong> —
          ohne Zugangsdaten für den Bildspeicher wird keines abgelegt. Name,
          Zeitpunkt und der Abzug der Positionen tragen den Nachweis auch ohne.
        </p>

        <div className="mt-s5 flex flex-wrap gap-s3">
          {/*
            * **Nachgetragen** (V-078, TIM-09).
            *
            * `leistungsnachweis_signatur.nachgetragen` steht seit `0066` da
            * und wurde nie geschrieben. Der Fall ist alltäglich: das Tablet
            * ist leer, der Kunde quittiert auf Papier, und die Aufnahme
            * geschieht am Abend im Büro. Ohne diesen Vermerk sähe die
            * Unterschrift aus, als wäre sie um 18:40 am Objekt geleistet
            * worden.
            *
            * Keine Uhrabweichung — die misst die Gerätezeit daneben.
            */}
          <label className="mb-s4 flex min-h-11 items-start gap-s3 text-sm text-text">
            <input type="checkbox" name="nachgetragen" value="1" className="mt-s1"
                   data-cse="unterschrift-nachgetragen" />
            <span>
              Nachgetragen
              <span className="mt-s1 block text-xs text-text-muted">
                Die Unterschrift wurde früher geleistet — auf Papier oder auf
                einem anderen Gerät — und wird jetzt erst erfasst. Die Zeit
                bleibt die des Servers; dieses Häkchen sagt nur, dass sie nicht
                die Zeit der Unterschrift ist.
              </span>
            </span>
          </label>

          <Button type="submit" variante="primary" disabled={!bereit}>
            Unterschreiben
          </Button>
          {darf['nachweis.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/reinigung/leistungsnachweise/${id}`}
              className="inline-flex min-h-11 items-center text-sm text-text-muted underline hover:text-text"
            >
              Abbrechen
            </Link>
          )}
        </div>
      </form>
    </PortalRahmen>
  );
}
