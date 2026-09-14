import type { FreigabeAnsicht, PosteingangEintrag } from './laden.js';

/**
 * Die JSON-Form der beiden Leseantworten (`GET /api/freigaben`,
 * `GET /api/freigaben/[id]`) — Daten als ISO-Zeitpunkte, Cent als Ziffern.
 *
 * Ausgelagert, weil eine Next.js-Route nur HTTP-Methoden exportieren darf:
 * der Build weist jeden anderen Export ab („is not a valid Route export
 * field"). Die Namen folgen der API-Karte (snake_case, `routine_faehig`).
 */
export function eintragAlsJson(z: PosteingangEintrag): Record<string, unknown> {
  return {
    id: z.id,
    titel: z.titel,
    zusammenfassung: z.zusammenfassung,
    vorgang_typ: z.vorgangTyp,
    aktion: z.aktion,
    risiko: z.risiko,
    frist: z.frist === null ? null : z.frist.toISOString(),
    betrag_cent: z.betragCent === null ? null : z.betragCent.toString(),
    erstellt_am: z.erstelltAm.toISOString(),
    unsichere_felder_anzahl: z.unsichereFelder,
    stapel_faehig: z.stapelFaehig,
    dringlichkeit: z.dringlichkeit,
    dringlichkeit_text: z.dringlichkeitText,
    sortschluessel: z.sortSchluessel,
  };
}

export function ansichtAlsJson(a: FreigabeAnsicht): Record<string, unknown> {
  const f = a.freigabe;
  return {
    freigabe: {
      id: f.id,
      titel: f.titel,
      zusammenfassung: f.zusammenfassung,
      vorgang_typ: f.vorgangTyp,
      aktion: f.aktion,
      status: f.status,
      risiko: f.risiko,
      risiko_punkte: f.risikoPunkte,
      frist: f.frist === null ? null : f.frist.toISOString(),
      betrag_cent: f.betragCent === null ? null : f.betragCent.toString(),
      erstellt_am: f.erstelltAm.toISOString(),
      unsichere_felder_anzahl: f.unsichereFelder,
      min_konfidenz: f.minKonfidenz,
      stapel_faehig: f.stapelFaehig,
      stapel_sperre_grund: f.stapelSperreGrund,
      erforderliches_recht: f.erforderlichesRecht,
      bezug_typ: f.bezugTyp,
      bezug_id: f.bezugId,
      freigegeben_von: f.freigegebenVon,
      freigegeben_am: f.freigegebenAm === null ? null : f.freigegebenAm.toISOString(),
      begruendung: f.begruendung,
      payload_hash: f.payloadHash,
      vorschau_payload: a.vorschau,
    },
    diff: a.diffRoh,
    felder: a.felder.map((x) => ({
      id: x.id,
      feld_pfad: x.feldPfad,
      bezeichnung: x.bezeichnung,
      wert_vorher: x.wertVorher,
      wert_nachher: x.wertNachher,
      konfidenz: x.konfidenz,
      unsicher: x.unsicher,
      grund: x.grund,
      quelle: x.quelle,
      extraktion_modell: x.extraktionModell,
    })),
    risiko: a.risiko,
    routine_faehig: a.routineFaehig,
    schnappschuss: a.schnappschuss === null ? null : {
      id: a.schnappschuss.id,
      kette_nr: a.schnappschuss.ketteNr.toString(),
      hash: a.schnappschuss.hash,
      art: a.schnappschuss.art,
      entschieden_am: a.schnappschuss.entschiedenAm.toISOString(),
      entschieden_von: a.schnappschuss.entschiedenVon,
      rolle: a.schnappschuss.rolle,
      begruendung: a.schnappschuss.begruendung,
      code_version: a.schnappschuss.codeVersion,
    },
  };
}
