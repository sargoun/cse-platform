-- 0304 — Der Leistungsnachweis auf der eigenen Schicht: vorlegen und
--        unterschreiben lassen (CLN-04, FIN-05, EMP-13, K-19, AUT-05).
--
-- ===========================================================================
-- Der Befund — drei Schritte, von denen heute keiner laeuft
-- ===========================================================================
--
-- 04-SEITENKARTE §7 gibt der Reinigungskraft auf ihrer Schicht den
-- Leistungsnachweis: „the customer signs on canvas". Der Dienst dafuer ist
-- vollstaendig (`erstelleEntwurf`, `legeVor`, `bereiteUnterschriftVor`,
-- `signiere`), und `nachweis.schreiben` haelt die Rolle `mitarbeiter`. Gegen
-- die lebende Datenbank gemessen scheitert trotzdem jeder Schritt:
--
-- 1. `erstelleEntwurf` setzt den Kopf mit `insert … returning id`. RETURNING
--    zieht die SELECT-Policies mit hinein, und es greift keine: `t_mandant`
--    verlangt `nachweis.lesen` (haelt die Rolle nicht), `t_person` verlangt
--    `app.scope() = 'person'` — wir stehen im M1-Scope. Gemessen: „new row
--    violates row-level security policy for table leistungsnachweis",
--    waehrend dieselbe Einfuegung OHNE returning durchgeht. Ein Rechtefehler,
--    der keiner ist (AUT-05).
--
-- 2. `leistungsnachweis_position.p_portal_decke` (RESTRICTIVE, FOR ALL) hat
--    einen `intern`- und einen `kunde`-Zweig und KEINEN Mitarbeiterzweig.
--    Gemessen: im Personen-Scope sieht die Kraft 4 Nachweiskoepfe und 0 von 7
--    Positionen. `ladePositionen` und `bereiteUnterschriftVor` liefern damit
--    ein LEERES Dokument und eine Pruefsumme ueber nichts — ausgerechnet das
--    Blatt, das der Kunde unterschreibt. Und weil die Policy nur USING traegt,
--    gilt sie auch fuer INSERT: Positionen sind auch nicht schreibbar.
--
-- 3. `legeVor` liest den Kopf `for update`, der Ausloeser
--    `kern.ln_signierbar()` schreibt ihn in derselben Anweisung auf
--    `signiert` — beides braucht eine UPDATE-Policy, die die Kraft nicht hat
--    (`t_mandant` USING verlangt `nachweis.lesen`).
--
-- ===========================================================================
-- Was hier NICHT geoeffnet wird
-- ===========================================================================
--
-- **Der Kunde bleibt weg.** `nachweis.lesen` wird nicht gebunden: das oeffnete
-- jeden Nachweis jeder Liegenschaft. Die Policies unten sind an
-- `app.ist_eingesetzt_auf_objekt` gebunden — dasselbe Praedikat, das
-- `leistungsnachweis.p_portal_decke` fuer das Mitarbeiterportal schon nennt.
-- Und es bleibt ein reines Selbstzugriffsmuster, kein neuer
-- Rechteschluessel (K-19, 04-SEITENKARTE §7).
--
-- **Die Positionen kommen aus der ZEILE, nicht ueber einen Join zum Kopf** —
-- ausser fuer die Zugehoerigkeit selbst. 0066 §1.8 begruendet die kopierten
-- Spalten `kunde_id`, `kopf_status`, `kopf_storniert_am` damit, dass eine
-- Policy nicht ueber den Elternteil joinen soll. Der Einschub unten fragt
-- deshalb nur EINS: gibt es den Kopf, und ist er fuer DIESE Sitzung sichtbar.
-- Das ist die Abgrenzung selbst — was die Kraft nicht sehen kann, dessen
-- Positionen kann sie auch nicht sehen —, und sie kann nicht auseinanderlaufen.
--
-- **Die Unterschrift des Kunden bleibt eine Zeile, die ihm gehoert.** 0066
-- §5.8 begruendet den Mitarbeiterzweig der Signaturdecke mit `anstellung_id`:
-- „die Unterschrift des KUNDEN traegt keine Anstellung und ist damit im
-- Mitarbeiterportal unsichtbar: sein Name gehoert ihm, nicht der Kraft, die
-- das Tablet gehalten hat." Diese Entscheidung bleibt — mit EINER Praezisierung,
-- ohne die CLN-04 nicht baubar ist: sichtbar wird zusaetzlich die Unterschrift,
-- die DIESES KONTO SELBST aufgenommen hat (`erstellt_von =
-- app.aktueller_benutzer()`). Sie stand daneben, als der Name geschrieben
-- wurde; ihr den Namen danach zu verbergen schuetzt niemanden, verhindert aber
-- das `returning` in `signiere` und damit die Bestaetigung auf dem Bildschirm.
-- Was weiterhin verborgen bleibt, ist jede Unterschrift, die jemand ANDERES
-- aufgenommen hat — und das ist der Fall, um den es in §5.8 geht.
--
-- **Kein Storno, kein Aendern, kein Loeschen.** Die UPDATE-Policy auf dem Kopf
-- laesst genau zwei Uebergaenge zu: `entwurf` -> `vorgelegt` (legeVor) und
-- `vorgelegt` -> `signiert` (der Ausloeser). Zurueckdrehen, stornieren oder
-- ablehnen bleibt dem Buero.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der Kopf
-- ---------------------------------------------------------------------------

create policy t_selbst_m1_lesen on leistungsnachweis for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and objekt_id is not null
  and app.ist_eingesetzt_auf_objekt(objekt_id)
);

/**
 * Die zwei Uebergaenge, die auf der Schicht geschehen.
 *
 * USING laesst nur `entwurf` und `vorgelegt` heran und nur, solange nichts
 * storniert ist; WITH CHECK laesst nur `vorgelegt` und `signiert` entstehen.
 * Damit ist jeder andere Weg — ablehnen, zurueckdrehen, stornieren — hier
 * nicht formulierbar, auch nicht versehentlich.
 *
 * `nachweis.schreiben` steht trotzdem in der WITH-CHECK-Haelfte: die Rolle
 * haelt es, und die zweite Linie soll dasselbe sagen wie das Tor (AUT-05).
 */
create policy t_selbst_m1_vorlegen on leistungsnachweis for update to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and objekt_id is not null
  and app.ist_eingesetzt_auf_objekt(objekt_id)
  and storniert_am is null
  and status in ('entwurf', 'vorgelegt')
)
with check (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and objekt_id is not null
  and app.ist_eingesetzt_auf_objekt(objekt_id)
  and storniert_am is null
  and status in ('vorgelegt', 'signiert')
  and (select app.hat_recht('nachweis.schreiben', app.aktiver_mandant()))
);

comment on policy t_selbst_m1_lesen on leistungsnachweis is
  'CLN-04 (0304): der Nachweis des eigenen Objekts im M1-Scope. Er traegt '
  'das returning in erstelleEntwurf und das for update in legeVor/signiere. '
  'Praedikat wie im Mitarbeiterzweig von p_portal_decke.';
comment on policy t_selbst_m1_vorlegen on leistungsnachweis is
  'CLN-04 (0304): entwurf -> vorgelegt (legeVor) und vorgelegt -> signiert '
  '(kern.ln_signierbar). Mehr laesst die Policy nicht zu — stornieren und '
  'ablehnen bleiben dem Buero.';

-- ---------------------------------------------------------------------------
-- 2. Die Positionen
-- ---------------------------------------------------------------------------

/**
 * Die Decke NEU gesetzt — eine Policy laesst sich nicht aendern.
 *
 * Die beiden vorhandenen Zweige stehen wortgleich wie in 0066; hinzu kommt der
 * Mitarbeiterzweig. Er fragt nach der Sichtbarkeit des Kopfes und traegt damit
 * dieselbe Grenze wie der Kopf selbst.
 */
drop policy p_portal_decke on leistungsnachweis_position;

create policy p_portal_decke on leistungsnachweis_position as restrictive for all to cse_app
  using (
    app.portal() = 'intern'
    or (app.portal() = 'kunde'
        and kunde_id = any (app.aktuelle_kunden())
        and kopf_status in ('vorgelegt','signiert')
        and kopf_storniert_am is null)
    or (app.portal() = 'mitarbeiter'
        and exists (select 1 from leistungsnachweis l
                     where l.mandant_id = leistungsnachweis_position.mandant_id
                       and l.id = leistungsnachweis_position.leistungsnachweis_id)));

/**
 * Und die Erlaubnis dazu — in BEIDEN Scopes des Mitarbeiterportals.
 *
 * `mandant_id = any (app.sichtbare_mandanten())` deckt den M1-Scope (dort ist
 * die Menge genau der aktive Mandant) und den Personen-Scope (dort die
 * lebenden Beschaeftigungen dieses Menschen, 0004). Eine zweite Policy je
 * Scope waeren zwei Fassungen derselben Frage.
 *
 * Geschrieben werden Positionen ueber `t_mandant` mit `nachweis.schreiben`;
 * was sie blockierte, war allein die Decke oben.
 */
create policy t_selbst_position on leistungsnachweis_position for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = any (app.sichtbare_mandanten())
  and exists (select 1 from leistungsnachweis l
               where l.mandant_id = leistungsnachweis_position.mandant_id
                 and l.id = leistungsnachweis_position.leistungsnachweis_id)
);

comment on policy t_selbst_position on leistungsnachweis_position is
  'CLN-04 (0304): die Positionen des sichtbaren Nachweises. Ohne sie baut '
  'bereiteUnterschriftVor einen LEEREN Abzug und eine Pruefsumme ueber '
  'nichts — und der Kunde unterschriebe ein leeres Blatt.';

-- ---------------------------------------------------------------------------
-- 3. Die Unterschriften
-- ---------------------------------------------------------------------------

drop policy p_portal_decke on leistungsnachweis_signatur;

create policy p_portal_decke on leistungsnachweis_signatur as restrictive for all to cse_app
  using (
    app.portal() = 'intern'
    or (app.portal() = 'kunde'
        and kunde_id = any (app.aktuelle_kunden())
        and kopf_status in ('vorgelegt','signiert')
        and kopf_storniert_am is null)
    or (app.portal() = 'mitarbeiter'
        and (anstellung_id in (select a.id from anstellung a
                                where a.person_id = app.aktuelle_person())
             /*
              * Die Unterschrift, die DIESES Konto selbst aufgenommen hat
              * (0304). §5.8 verbirgt vor der Kraft den Namen, den ein ANDERER
              * aufgenommen hat — nicht den, den sie selbst gerade
              * entgegengenommen hat. Ohne diesen Zweig scheitert das
              * `returning` in `signiere`, und die Kraft sieht nach dem
              * Fingerdruck des Kunden keine Bestaetigung.
              */
             or erstellt_von = app.aktueller_benutzer())));

create policy t_selbst_signatur on leistungsnachweis_signatur for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = any (app.sichtbare_mandanten())
  and (anstellung_id in (select a.id from anstellung a
                          where a.person_id = app.aktuelle_person())
       or erstellt_von = app.aktueller_benutzer())
);

comment on policy t_selbst_signatur on leistungsnachweis_signatur is
  'CLN-04, EMP-13 (0304): die eigene Gegenzeichnung (anstellung_id) und die '
  'Unterschrift, die dieses Konto selbst aufgenommen hat (erstellt_von). '
  'Jede andere bleibt im Mitarbeiterportal unsichtbar — 0066 §5.8.';

-- ---------------------------------------------------------------------------
-- 4. Der Kopf des Nachweises fuer die Kraft — als DEFINER-Zahlenwerk
-- ---------------------------------------------------------------------------
--
-- **Der Befund, der diese Funktion noetig macht.** `findeNachweis` verbindet
-- den Kopf mit `kunde` als INNER JOIN — der Kundenname steht im Dokument, und
-- `baueSchnappschuss` nimmt ihn in den Abzug auf, ueber den die Pruefsumme
-- laeuft. Fuer `cse_app` ist `kunde` im Mitarbeiterportal aber nicht lesbar:
-- `t_mandant` verlangt `crm.lesen`, und EMP-13/K-05 wollen das auch so — die
-- Kraft bekommt keinen Kundenstamm. Gemessen im M1-Scope als Mitarbeiterin:
-- `select count(*) from kunde` = 0, waehrend `leistungsnachweis` 2 Zeilen
-- zeigt. Der INNER JOIN macht daraus NULL ZEILEN, und
-- `bereiteUnterschriftVor` wirft `NachweisNichtGefunden` auf einen Nachweis,
-- den die Kraft gerade selbst angelegt hat (AUT-05).
--
-- Den Kundenstamm dafuer zu oeffnen waere die falsche Antwort. Was das
-- Dokument braucht, ist EIN NAME — nicht die Kundenakte. Also derselbe Weg wie
-- in 0277 und 0299: `security definer` heisst „ein anderes Recht", nicht „kein
-- Recht" (D-366). Die Funktion prueft, was die Zeilenpolicy pruefen wuerde —
-- Mitarbeiterportal, eigene Beschaeftigung, Einsatz auf DIESEM Objekt — und
-- gibt genau die Kopffelder des Nachweises zurueck, die auf dem
-- Unterschriftsblatt stehen. Kein Preis, kein Auftrag, keine Anschrift, keine
-- zweite Zeile des Kunden.
--
-- Die Rechte, die die Funktion dafuer braucht, sind spaltenweise: auf `objekt`
-- bekommt `cse_definer` genau vier Spalten. Ein ungeteiltes
-- `grant select on objekt` truege die eine Spalte mit, die K-05 der
-- Anwendungsrolle entzogen hat.

grant select (id, mandant_id, bezeichnung, kunde_id) on objekt to cse_definer;

/*
 * Und das Praedikat selbst: `app.ist_eingesetzt_auf_objekt` war bisher nur
 * `cse_app` zugaenglich. Eine Definer-Funktion laeuft als ihr Eigentuemer —
 * ohne diesen Grant scheitert das Tor unten mit „permission denied for
 * function", also genau an der Pruefung, die es strenger machen soll.
 */
grant execute on function app.ist_eingesetzt_auf_objekt(uuid) to cse_definer;
create policy d_nachweis_kopf on objekt for select to cse_definer using (true);

/*
 * **Und `kunde` — die Zeile, an der die erste Fassung dieser Migration selbst
 * in AUT-05 lief.**
 *
 * Der Kommentar oben nahm an, `cse_definer` lese `kunde` „schon". Das stimmt
 * nur im Mandantenscope: die einzige permissive SELECT-Policy dieser Rolle ist
 * `d_kunde_pflichtfeld` mit `mandant_id = app.aktiver_mandant()` (0033), und
 * der ist im Personen-Scope NULL (K-20). Die Seite
 * `/portal/mein/schichten/[zuordnungId]/leistungsnachweis` laeuft aber GENAU
 * dort. Gemessen im Personen-Scope: `leistungsnachweis` 1 Zeile,
 * `app.ist_eingesetzt_auf_objekt` true, `set role cse_definer; select count(*)
 * from kunde` = 0 — und damit `app.leistungsnachweis_kopf_schicht(...)` = 0
 * Zeilen. Derselbe INNER-JOIN-Fehler, eine Ebene tiefer: null Zeilen statt
 * „ohne Namen", und die Folge auf dem Bildschirm ist nicht „ohne Namen",
 * sondern wieder das Anlegeformular — jeder Klick ein weiterer vorgelegter
 * Nachweis.
 *
 * **Warum nicht `mandant_id = any (app.sichtbare_mandanten())`.** Das waere
 * die kurze Fassung und oeffnete jeder kuenftigen Definer-Funktion im
 * Personen-Scope den ganzen Kundenstamm beider Beschaeftigungen. Eine Policy
 * gilt der ROLLE, nicht dem Aufrufer. Deshalb traegt sie hier dasselbe Tor wie
 * die Funktion — Mitarbeiterportal, eigene Beschaeftigung, Einsatz auf dem
 * Objekt — und zusaetzlich die Bedingung, dass es ueberhaupt einen
 * Leistungsnachweis dieses Kunden auf einem solchen Objekt gibt. Sichtbar wird
 * damit genau der Name, der auf dem Unterschriftsblatt steht.
 *
 * Der Einschub auf `leistungsnachweis` laeuft als `cse_definer`; dort traegt
 * `d_medien_bezug` (0093) `using (true)`, es entsteht also keine
 * Ringabhaengigkeit ueber `kunde` zurueck.
 */
create policy d_kunde_nachweis_kopf on kunde for select to cse_definer
using (
  app.portal() = 'mitarbeiter'
  and app.aktuelle_person() is not null
  and mandant_id = any (app.sichtbare_mandanten())
  and exists (
    select 1
      from public.leistungsnachweis l
     where l.kunde_id = kunde.id
       and l.mandant_id = kunde.mandant_id
       and l.objekt_id is not null
       and app.ist_eingesetzt_auf_objekt(l.objekt_id)
  )
);

comment on policy d_kunde_nachweis_kopf on kunde is
  'CLN-04, EMP-13 (0304): der EINE Kundenname, den das Unterschriftsblatt der '
  'Kraft braucht — fuer cse_definer und nur dort, wo ein Leistungsnachweis '
  'dieses Kunden auf einem Objekt liegt, auf dem dieser Mensch eingesetzt ist. '
  'd_kunde_pflichtfeld haengt an app.aktiver_mandant() und ist im '
  'Personen-Scope NULL (K-20); ohne diese Zeile gibt '
  'app.leistungsnachweis_kopf_schicht dort null Zeilen zurueck (AUT-05).';

create function app.leistungsnachweis_kopf_schicht(p_nachweis uuid)
returns table (
  id               uuid,
  nummer           text,
  status           text,
  objekt_id        uuid,
  objekt           text,
  revier_id        uuid,
  revier           text,
  kunde_id         uuid,
  kunde            text,
  von              text,
  bis              text,
  vorgelegt_lokal  text,
  gesperrt_lokal   text,
  storniert_lokal  text,
  abgelehnt_grund  text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
begin
  /**
   * Das Tor, und es ist dasselbe wie die Policy: nur im Mitarbeiterportal,
   * nur in einer Gesellschaft, in der dieser Mensch beschaeftigt ist, und nur
   * auf einem Objekt, auf dem er eingesetzt ist. Ohne diese drei waere die
   * Funktion ein Weg um die RLS herum statt ein anderer Weg durch sie.
   *
   * Kein `raise` bei Nichttreffer: null Zeilen sind die Antwort, und der
   * Aufrufer macht daraus 404 (AUT-06). Ein Fehler hier waere die Auskunft,
   * dass es die Zeile gibt.
   */
  if app.portal() <> 'mitarbeiter' or app.aktuelle_person() is null then
    return;
  end if;

  return query
    select l.id,
           l.nummer,
           l.status::text,
           l.objekt_id,
           o.bezeichnung,
           l.revier_id,
           rv.bezeichnung,
           l.kunde_id,
           k.name,
           to_char(l.leistungszeitraum_von, 'YYYY-MM-DD'),
           to_char(l.leistungszeitraum_bis, 'YYYY-MM-DD'),
           to_char(l.vorgelegt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'),
           to_char(l.gesperrt_am  at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'),
           to_char(l.storniert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'),
           l.abgelehnt_grund
      from public.leistungsnachweis l
      join public.kunde k  on k.id = l.kunde_id  and k.mandant_id = l.mandant_id
      left join public.objekt o  on o.id = l.objekt_id and o.mandant_id = l.mandant_id
      left join public.revier rv on rv.id = l.revier_id and rv.mandant_id = l.mandant_id
     where l.id = p_nachweis
       and l.mandant_id = any (app.sichtbare_mandanten())
       and l.objekt_id is not null
       and app.ist_eingesetzt_auf_objekt(l.objekt_id);
end $$;

alter function app.leistungsnachweis_kopf_schicht(uuid) owner to cse_definer;
revoke execute on function app.leistungsnachweis_kopf_schicht(uuid) from public;
grant execute on function app.leistungsnachweis_kopf_schicht(uuid) to cse_app;

comment on function app.leistungsnachweis_kopf_schicht(uuid) is
  'CLN-04, EMP-13 (0304): der Kopf des Leistungsnachweises fuer die Kraft auf '
  'der Schicht. Sie braucht den Kundennamen fuer das Unterschriftsblatt und '
  'den Abzug, darf aber keinen Kundenstamm lesen (K-05) — also ein anderes '
  'Recht, nicht kein Recht (D-366). Geprueft werden Portal, Beschaeftigung '
  'und Einsatz auf dem Objekt; ein fremder Nachweis ergibt null Zeilen und '
  'damit 404 (AUT-06).';

-- ---------------------------------------------------------------------------
-- 5. Die Nummer — derselbe Nachweis bekommt aus dem Buero eine und von der
--    Schicht keine
-- ---------------------------------------------------------------------------
--
-- **Der Befund.** `legeVor` zieht die Nummer ueber `vergebeNummer`, und
-- `nummernkreis` traegt die restriktive Decke `p_nk_intern_ceiling` USING
-- `app.portal() = 'intern'`. Im M1-Scope des Mitarbeiterportals ist die Tabelle
-- damit vollstaendig unsichtbar. Gemessen als Mitarbeiterin in ihrem Mandanten:
-- `select count(*) from nummernkreis` = 0, obwohl die Datenbank drei
-- nicht-Platzhalterkreise des Typs `leistungsnachweis` fuehrt. `vergebeNummer`
-- meldet `kein_kreis`, `legeVor` faengt genau diesen Grund ab und gibt ihn als
-- `nummerOffen` zurueck — der Nachweis steht auf `vorgelegt` und traegt
-- `nummer = NULL`.
--
-- Das ist kein Schutz, sondern eine stille Ungleichheit: derselbe Vorgang,
-- aus dem Buero ausgeloest, bekommt eine Nummer. Und die Nummer steht im Kopf,
-- geht ueber `baueSchnappschuss` in den Abzug und damit in die Pruefsumme, die
-- der Kunde unterschreibt — zwei Blaetter desselben Monats, eines mit und eines
-- ohne Nummer, je nachdem wer den Knopf gedrueckt hat.
--
-- **Was hier geoeffnet wird, und nicht mehr.** Genau EIN Kreistyp,
-- `leistungsnachweis`, und nur im Mitarbeiterportal. Alles andere bleibt, wie
-- es war: der Ausgangsrechnungs- und Gutschriftkreis ist `d_kreis_ziehen`
-- ohnehin entzogen (er laeuft ueber `fin.rechnung_nummer_ziehen`), und die
-- Spaltenrechte von `cse_app` auf `nummernkreis` erlauben ohnehin nur den
-- Zaehler und die Aenderungsspur — nicht die Maske, nicht `geschlossen_am`,
-- nicht `lueckenlos`. Was die Kraft damit kann, ist eine Nummer ZIEHEN; was sie
-- nicht kann, ist einen Kreis anlegen, schliessen oder umformatieren.
--
-- Ein Definer-Weg wie `nk_wachbuch_definer` (0070) waere die Alternative. Er
-- ist hier die schlechtere: `vergebeNummer` ist die eine getestete Stelle, an
-- der `SELECT … FOR UPDATE` die Vergabe serialisiert (Invariante 4 sinngemaess),
-- und eine zweite Fassung derselben Rechnung daneben zu stellen hiesse, die
-- Luecken-Zusage zweimal zu halten.
--
-- Die Decke wird NEU GESETZT und nicht erweitert — eine Policy laesst sich
-- nicht aendern. Der `intern`-Zweig steht wortgleich wie zuvor.
--
-- // TODO(client, O-147): Sollen Leistungsnachweise fortlaufend und lueckenlos nummeriert sein, und ab welchem Schritt — Vorlage oder Unterschrift?

drop policy p_nk_intern_ceiling on nummernkreis;

create policy p_nk_intern_ceiling on nummernkreis as restrictive for all to cse_app
  using (
    app.portal() = 'intern'
    or (app.portal() = 'mitarbeiter' and kreis_typ = 'leistungsnachweis')
  );

comment on policy p_nk_intern_ceiling on nummernkreis is
  'FIN-03 (0304): die Nummernkreise gehoeren dem Buero — mit EINER Ausnahme. '
  'Der Leistungsnachweis, den die Kraft auf ihrer Schicht vorlegt, laeuft '
  'durch dasselbe legeVor wie der aus dem Buero; ohne diesen Zweig bekaeme er '
  'still keine Nummer (nummerOffen = kein_kreis), und dieselbe Handlung haette '
  'je nach Bildschirm ein anderes Ergebnis. Geoeffnet ist genau der Kreistyp '
  'leistungsnachweis; die Spaltenrechte von cse_app lassen ohnehin nur den '
  'Zaehler zu.';
