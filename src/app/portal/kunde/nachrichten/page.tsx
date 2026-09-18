import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  listeKundennachrichten, type Kundennachricht,
} from '@/server/services/kundenportal/nachricht';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import { Gesellschaft, KeinZugang, Kopfzeile, Leer, Offen } from '../bausteine';

/**
 * `/portal/kunde/nachrichten` — der Nachrichtenfaden mit der Gesellschaft
 * (NOT-03, SPEC §22 `nachricht`, 04-SEITENKARTE §8).
 *
 * **Diese Seite war bis 0255 technisch unmoeglich, nicht bloss ungebaut.**
 * `nachricht` trug keinen Kundenbezug, und die einzigen erlaubenden Policies
 * hingen an `app.aktiver_mandant()` (im Kunden-Scope NULL, K-20) oder an
 * `gruppe.nachricht.lesen`. Eine Kundensitzung las exakt null Zeilen, und die
 * Seite haette „Keine Nachrichten" gezeigt — der Fehlermodus aus
 * 04-SEITENKARTE §8 unter K-18, der sich fuer den Kunden liest wie „ich habe
 * kein Geschaeft mit euch".
 *
 * **Der Absender ist die GESELLSCHAFT, nie ein Mensch** — die Begruendung
 * steht im Dienst: §8 verschliesst dem Kunden das ganze `personal`-Modul.
 *
 * **Kein Verfassen-Knopf und kein Antwortfeld.** Nicht ausgegraut, sondern
 * nicht vorhanden: `nachricht.versenden` ist der Rolle `kunde` nicht erteilt,
 * und der Kontext hinter der Seite hat kein `schreibe` (Compilerfehler statt
 * Laufzeitentscheidung). Stattdessen steht der Satz, der den heutigen Weg
 * nennt.
 */
export const dynamic = 'force-dynamic';

export default async function Kundennachrichten() {
  const ergebnis = await kundePortal('/portal/kunde/nachrichten',
    async (kontext) => listeKundennachrichten(kontext));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Nachrichten" aktiverTab="nachrichten">
        <Kopfzeile titel="Nachrichten" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;
  const ungelesen = daten.filter((n) => !n.gelesen).length;

  return (
    <KundenRahmen basis={basis} titel="Nachrichten" aktiverTab="nachrichten">
      <Kopfzeile titel="Nachrichten">
        {ungelesen > 0 && (
          <p data-cse="nachrichten-offen" className="m-0 text-base text-text-muted">
            <span className="cse-zahl">{ungelesen}</span> ungelesen
          </p>
        )}
      </Kopfzeile>

      {daten.length === 0 ? (
        <Leer text="Es liegt keine Nachricht für Sie vor. Schriftverkehr, der über
          Ihre Ansprechpartnerin läuft, erscheint hier erst, wenn er dem Portal
          zugeordnet wurde." />
      ) : (
        <DataTable
          beschriftung="Nachrichten mit Betreff, Zeitpunkt, Gesellschaft und Lesezustand"
          zeilen={daten}
          schluessel={(n: Kundennachricht) => n.id}
          spalten={[
            {
              schluessel: 'betreff',
              kopf: 'Betreff',
              zelle: (n) => (
                <Link
                  href={`/portal/kunde/nachrichten/${n.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {n.betreff ?? <span className="text-text-subtle">ohne Betreff</span>}
                </Link>
              ),
            },
            {
              schluessel: 'richtung',
              kopf: 'Richtung',
              /*
               * „Von Ihnen" / „An Sie" und nicht `eingehend`/`ausgehend`: die
               * Enumwerte stehen aus SICHT DES HAUSES, und im Kundenportal
               * las sich „ausgehend" wie „ich habe es geschickt".
               */
              zelle: (n) => n.richtung === 'eingehend' ? 'Von Ihnen' : 'An Sie',
            },
            {
              schluessel: 'zeitpunkt',
              kopf: 'Zeitpunkt (Berlin)',
              zelle: (n) => <span className="cse-zahl">{n.zeitpunktLokal}</span>,
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (n) => <Gesellschaft slug={n.mandantSlug} name={n.mandantName} />,
            },
            {
              schluessel: 'anhaenge',
              kopf: 'Anlagen',
              numerisch: true,
              zelle: (n) => n.anhaenge === 0
                ? <span className="text-text-subtle">—</span>
                : String(n.anhaenge),
            },
            {
              schluessel: 'gelesen',
              kopf: 'Zustand',
              /*
               * `Wartet` und `Inaktiv` sind das feste Pillenvokabular von
               * DESIGN §5 — „Ungelesen" und „Gelesen" stehen dort nicht, und
               * `StatusPill` laesst eine unbekannte Beschriftung gar nicht
               * zu. Dieselbe Abbildung wie im Mitarbeiterposteingang.
               */
              zelle: (n) => n.richtung !== 'ausgehend'
                /*
                 * Keine Pille an der eigenen Nachricht. `gelesen` ist fuer
                 * `eingehend` per Definition `true` (der Dienst bildet den
                 * Zustand nur fuer `ausgehend`); eine Pille „Inaktiv" daneben
                 * beantwortete trotzdem eine Frage, die hier niemand stellt.
                 */
                ? <span className="text-text-subtle">—</span>
                : <StatusPill zustand={n.gelesen ? 'Inaktiv' : 'Wartet'} />,
            },
          ]}
        />
      )}

      <div className="mt-s5 flex flex-col gap-s4">
        <Offen
          nummer="O-74"
          was="Antworten läuft über Ihre Ansprechpartnerin"
          weg="Das Portal ist lesend; ob ein Kundenzugang im Portal schreiben darf,
            ist noch nicht entschieden."
        />
      </div>
    </KundenRahmen>
  );
}
