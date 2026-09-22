import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, alsJobSitzung, type JobVerbindung } from './sitzung.js';

/**
 * Der Lauf, der jedem Beschäftigten sein Urlaubskonto des Jahres öffnet
 * (V-117, EMP-05, § 3 BUrlG).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: `eroeffneUrlaubskonto` hatte ausser Tests keinen Aufrufer.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Genau die Lücke, die `kontenRollover` beim Stundenkonto geschlossen hat —
 * eine Tabelle weiter. Jedes Urlaubskonto der Plattform entstand im Seed;
 * `anspruchOderFehler` wirft, wo keines ist, und am 1. Januar hätte jeder
 * Urlaubsantrag gegen ein Konto gerechnet, das es nicht gibt.
 *
 * Gefunden hat ihn nicht ein Mensch, sondern `tests/kern/dienst-verdrahtung.
 * test.ts` — die Sperrklinke gegen genau diese Bauart: gebaut, geprüft, und
 * von nirgendwo auslösbar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was er tut — und wovon er die Finger lässt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  * **Er öffnet, was fehlt.** Je aktiver Anstellung das Konto des laufenden
 *    Berliner Jahres, idempotent (`on conflict do nothing`). Ein zweiter Lauf
 *    am selben Tag ändert nichts.
 *  * **Er setzt KEINEN Anspruch.** Wie viele Urlaubstage eine Anstellung hat,
 *    steht im Arbeitsvertrag und ist der Plattform nicht bekannt (O-18).
 *    `anspruch_tage` bleibt 0, und das heisst „nicht hinterlegt" — nicht
 *    „null Tage Urlaub". Eine hergeleitete Zahl (die 20 des § 3 BUrlG, oder
 *    24 Werktage, oder was im Tarif steht) sähe aus wie eine vereinbarte und
 *    würde zur Grundlage eines Restanspruchs, den niemand zugesagt hat. Die
 *    Zahl trägt ein Mensch nach — dafür ist `setzeAnspruch` da (V-118).
 *  * **Er überträgt keinen Rest.** Ob und wie lange Resturlaub ins Folgejahr
 *    geht, ist Vertrags- und Tarifrecht (§ 7 Abs. 3 BUrlG kennt den 31. März
 *    als Regelfall und viele Ausnahmen). `uebertrag_tage` bleibt 0 und
 *    `uebertrag_verfaellt_am` NULL — „keine Frist hinterlegt", nicht
 *    „verfällt nie".
 *
 * **Täglich um 00:45 Berliner Zeit.** Nicht nur am 1. Januar: die Anstellung,
 * die am 12. Februar beginnt, braucht ihr Konto am 12. Februar. Ein Konto,
 * das erst im nächsten Januar entstünde, liesse elf Monate Urlaub ins Leere
 * laufen. Eine Viertelstunde nach dem Stundenkonto-Lauf, damit die beiden
 * nicht um dieselbe Sperre auf `anstellung` konkurrieren.
 */
export function registriereUrlaubskontenJahr(db: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'urlaubskonten_jahr',
    bezeichnung: 'Urlaubskonten des laufenden Jahres öffnen (EMP-05, § 3 BUrlG)',
    zeitplan: '45 0 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      /*
       * Gefunden als `cse_job` ueber alle Gesellschaften, geschrieben je
       * Mandant in dessen Sitzung — dieselbe Bauart wie `kontenRollover`.
       * `app.berlin_heute()` und nicht `current_date`: zwischen 23:00 und
       * 24:00 UTC ist in Berlin schon der Folgetag, und am 31. Dezember waere
       * das das falsche JAHR.
       */
      const offen = await alsJobRolle(db, (jd) => jd.abfrage<{
        mandant_id: string; anstellung_id: string; jahr: number;
      }>(
        `with heute as (select app.berlin_heute() as tag)
         select a.mandant_id,
                a.id                            as anstellung_id,
                extract(year from h.tag)::int   as jahr
           from anstellung a
           cross join heute h
          where a.geloescht_am is null
            and a.status = 'aktiv'
            and not exists (
                  select 1 from urlaubskonto u
                   where u.anstellung_id = a.id
                     and u.jahr = extract(year from h.tag)::int)
          order by a.mandant_id, a.id
          limit 5000`));

      const jeMandant = new Map<string, typeof offen>();
      for (const z of offen) {
        jeMandant.set(z.mandant_id, [...(jeMandant.get(z.mandant_id) ?? []), z]);
      }

      let eroeffnet = 0;
      for (const [mandantId, zeilen] of jeMandant) {
        await alsJobSitzung(db, mandantId, async (jd) => {
          for (const z of zeilen) {
            /*
             * `on conflict do nothing` und nicht „erst pruefen, dann
             * schreiben": zwei gleichzeitige Laeufe saehen beide kein Konto.
             * Die Eindeutigkeit `(anstellung_id, jahr)` entscheidet, nicht
             * die Reihenfolge.
             */
            const zeile = await jd.abfrage<{ id: string }>(
              `insert into urlaubskonto
                 (mandant_id, anstellung_id, jahr, anspruch_tage, uebertrag_tage,
                  zusatz_tage)
               values ($1, $2, $3, 0, 0, 0)
               on conflict (anstellung_id, jahr) do nothing
               returning id`,
              [mandantId, z.anstellung_id, z.jahr]);
            if (zeile.length > 0) eroeffnet += 1;
          }
        }, {
          /*
           * **`nurLesen: false` — dieser Lauf SCHREIBT** (V-119).
           *
           * `alsJobSitzung` setzt `app.readonly` sonst auf `on`, und die
           * Policy `j_urlaubskonto_anlegen` (0380) verlangt `not app.ist_readonly()`.
           * Ohne diese Zeile scheitert der Lauf sichtbar — was besser ist,
           * als still nichts zu tun, und genau deshalb steht die Bedingung
           * in der Policy.
           */
          nurLesen: false,
        });
      }

      return {
        gepruefte_anstellungen: offen.length,
        eroeffnet,
        /*
         * Der Anspruch bleibt offen, und das steht im Protokoll — damit
         * niemand aus „500 Konten eroeffnet" schliesst, dass 500 Menschen
         * jetzt Urlaub beantragen koennen.
         */
        anspruch_offen: 'O-18: die Urlaubstage je Anstellung traegt ein Mensch nach.',
      };
    },
  });
}
