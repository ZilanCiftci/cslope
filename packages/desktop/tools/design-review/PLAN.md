# Plan: grundlig designgranskning av cSlope-appen

Mål: öppna varje del av appen som går att öppna, ta skärmdumpar av dem i båda teman, bedöma dem mot `docs/design-rules.md` och leverera en prioriterad lista med fynd, med bild, regel och föreslagen åtgärd, utan att ändra någon kod under granskningen.

## 1. Vad som granskas (inventering)

Inventeringen tas från koden, inte ur minnet, så att inget missas. Varje rad blir en "scen" med ett id.

**Huvudfönstret, redigeringsläge**
- Ribbon: flikarna File, Model, Results, Help, Dev; varje flik i normal bredd och i smal bredd (ca 1100 px) där grupperna trycks ihop.
- Ribbonens rullgardiner: File ▾ (Save as anonymized…, Import, Export ▾ med undermenyer), Edit, Results › Surfaces ▾, Reference line ▾, Export ▾, Drawing ▾ (Pick lines…), Help, Dev.
- Modellpanelen: tom lista; en modell; många modeller (58) med långa namn; modell med ritningar (hopfälld och utfälld); Attachments; markerad respektive aktiv modell; status-prickar i alla fyra lägen (ej körd, kör, klar, fel).
- Kontextmenyn på en modell (enkel- och flerval), på ritytan (tomt ställe, på en punkt, på en gräns, på en last, på en ritning låst/olåst, med Lock all-undermenyn), på en annotering i resultatläget.
- Properties-sidopanelen i redigeringsläget: varje sektion i sidopanelen (Geometry, Materials, Assign, Search limits, Options med alla undergrupper utfällda: direction, strength reduction FE, tension crack, seismic, 3D, rapid drawdown, block search…), varje varning i dem (Limits direction warning, FE experimental-märket).
- Flytande verktygsfältet (Edit/Results/Run, Run ▾-menyn, zoom), Pick lines-baren, Analysis failed-bannern (med och utan knappar), "click a region to assign"-hinten, PointEditor-popupen, AnnotationStyleMenu, InsertVariableMenu.
- Statusraden: EDIT och RESULT, med FOS, med Run all-progress, Run all klar med fel, Analysis failed, markering/lås-texten, snap-fältet.
- Canvasens markeringstillstånd: markerad punkt, markerad gräns med handtag, markerad söklimit, markerad ritning (ram), låst objekt med hänglås, drag-läge.

**Huvudfönstret, resultatläge**
- Resultatsidopanelen: Summary (lyckad körning, med noter utfällda, fel, FE-resultat med stage, Custom surface-rader), Layers (tom, full, markerad rad, hover med grepp, drag-indikator), Properties › Sheet, annoteringsegenskaper (text, materialtabell, färgskala, plot, referenslinje).
- Resultatritningen: ljust och mörkt papper, med alla lager på, med filter, färgskala, materialtabell med S=f(z)-kolumner, titelraden på/av.

**Separata fönster (BrowserWindows)** — var och en i normalstorlek och i minsta storlek, tom och fylld:
Materials (varje materialmodell-formulär: M-C, Undrained, S=f(z), SHANSEP, Hoek–Brown, anisotropi, φb, shear-normal-funktion), Assign materials, Geometry (points-tabellen), Interior boundaries, Distributed loads, Line loads, Reinforcement (varje typ), Piezometric lines, Parameters, Search limits, Custom surfaces (cirkel och polylinje), Options, Results plot (båda plot-lägena, alla grupper i Y-select), Sensitivity, Probabilistic, Place drawing (tom, bild, PDF med sidremsa, DWG med lager, varje kalibreringsläge, beskärning), New models from drawing.

**Modala dialoger i fönstret**: Model properties (ett och flera val), Save as anonymized, SummaryDialog (import- och exportsammanfattningar), About, window.confirm-rutor (Delete model, byte av ritning), ErrorBoundary-sidan.

**Tillstånd som gäller allt**: ljust tema, mörkt tema; Windows-fönsterramen (native frame under dold titelrad); 100 % och 150 % DPI-skalning; smal höjd (720 px) så att scroll syns i sidopaneler och dialoger.

Inventeringen skrivs som `scenes.ts`: `{ id, title, open(): steps, states: ["light","dark"], viewport, notes }`. Antal scener: uppskattningsvis 180–220 bilder per tema.

## 2. Hur det öppnas (orkestrering)

- Verktyg: den befintliga media-capture-rutinen (`packages/desktop/tools/media-capture`), som startar Electron under xvfb med Playwright och styr appen genom storen (`store-capture.ts`). Den byggs ut med en ny körning `design-review` som tar en scenlista i stället för hemsidans scener. Inget av detta checkas in förrän det är granskat; granskningsskripten ligger först i scratchpad.
- Separata fönster öppnas som i appen (IPC `window:open…Dialog`), och Playwright kopplar till det nya BrowserWindow-fönstret via `app.windows()`/`waitForEvent("window")`. Dialogfönster som behöver data får den genom samma IPC som appen (fönstret begär state av huvudfönstret).
- Kontextmenyer och rullgardiner öppnas med riktiga klick och högerklick på kända element (roller och namn, aldrig CSS-klasser), så att bilden visar vad användaren ser inklusive position.
- window.confirm/alert fångas: Playwrights `page.on("dialog")` tar texten, och en skärmdump av en efterliknad ruta ritas inte; texten granskas i stället som text.
- Varje scen körs i en färsk app-instans var tionde scen (för att undvika att tillstånd läcker) och alltid i ordningen: ladda modell → sätt tema → öppna → vänta `RENDER_SETTLE_MS` → skärmdump vid DPR 2 → stäng.
- Testdata: tre modeller räcker: det inbyggda exemplet (enkelt), ett verifieringsproblem med S=f(z), vatten, laster och armering (fylld materialtabell), och en modell med PDF- och DWG-ritning (ur repots fixtures; ingen kunddata).
- Tidsplan: inventering och scenfil 1–2 h, körning 20–30 min per tema, bedömning 2–3 h, rapport 1 h. Körs över natten utan att något annat belastar maskinen.

## 3. Vad som kontrolleras (checklista per bild)

Bedömningen görs mot `docs/design-rules.md`. Varje bild får en checklista; ett "nej" blir ett fynd.

1. **Röst**: sentence case, amerikansk stavning, enheter i parentes, inga egna beteckningar som "PWP" utan namn, inga avhuggna texter, inga "…" som saknas på knappar som öppnar något, inga produktnamn.
2. **Färg**: endast tema-tokens (kontrolleras även i koden med grep efter literal färger i tsx); vald rad ljusblå, hover grå, accent bara på primärknapp/toggle/markering; status-färger rätt; kontrast ≥ 4,5:1 för text (mäts automatiskt i bilden: textfärg mot bakgrund med en kontrastberäkning per textnod via `getComputedStyle` i samma körning, inte med ögat).
3. **Typografi och avstånd**: 12/11/10 px enligt reglerna; 4 px-rutnät; 22 px kontroller; 24 px ikonknappar; inga dubbla ramar; konsekventa marginaler (mäts med `getBoundingClientRect` på dialogens kant, rubrik, första fält, knapprad: samma värden i alla dialoger).
4. **Kontroller**: `.btn` på alla knappar; en primärknapp per dialog, högerjusterad; toggles med `aria-pressed`; tabellvyer för listor; "+ Add …" som textlänk; × på hover.
5. **Dialoglayout**: rubrik 12 px semibold, förklaringsmening, scrollande kropp, knapprad under linje; fönstret inte för litet (inget avklippt), inte för stort (inte mer än 30 % tom yta).
6. **Ikoner**: lucide, 1.75, monokroma; samma ikon för samma begrepp överallt (t.ex. öga, hänglås, papperskorg); inga handritade utanför ribbonen.
7. **Tillgänglighet**: varje interaktivt element har namn (kontrolleras automatiskt med en axe-core-körning per scen; brott listas som fynd).
8. **Tema**: samma scen i ljust och mörkt läggs sida vid sida; allt som syns i det ena ska synas i det andra (automatiskt: skillnad i antal synliga element och textnoder).
9. **Tillstånd**: tomt läge har en mening; fel och varningar har handling; disabled syns men är läsbart.
10. **Konsekvens mellan skärmar**: samma sak ser likadan ut: listor i Models, Layers, Attachments och dialogtabeller; samma knapprad i alla fönster. Detta kontrolleras i ett eget steg efter per-bild-steget, med alla dialoger i en kontaktkarta.

## 4. Hur bilderna bedöms

- Steg A, automatiskt: per scen sparas förutom PNG en JSON med alla textnoder (text, fontstorlek, färg, bakgrund, kontrast), alla knappar (klass, höjd), dialogens mått och axe-resultat. Ett skript gör fynd av allt som bryter mot mätbara regler (kontrast, höjd, fontstorlekar, saknade namn, literal färger, title case i etiketter via en ordlista). Detta ger en lista utan subjektivitet.
- Steg B, visuell bedömning: bilderna granskas av mig, i grupper om 10–12 per sida (kontaktkarta med scen-id), i ordningen huvudfönster → sidopaneler → fönster → menyer. För varje bild svarar jag på checklistan ovan och noterar fynd med scen-id, regelns rubrik, beskrivning och förslag. Parallellt låter jag en andra granskare (en agent med bara bilderna och regeldokumentet, utan mina fynd) göra samma sak, och jämför: fynd som bara en av oss hittat kontrolleras en gång till. Det minskar både missar och tyckande.
- Steg C, konsekvens: dialogernas måttsiffror (padding, rubrikposition, knapprad) läggs i en tabell; avvikare blir fynd. Ljust/mörkt-paren jämförs.
- Allvarlighetsgrad: **A** fel (avklippt, oläsligt, trasigt, kontrast under 3:1, saknad funktion), **B** regelbrott som syns (fel färg, fel storlek, fel ordval, inkonsekvens), **C** finputs. Varje fynd får en uppskattad insats (S/M/L).

## 5. Leverans

- `design-review/report.md`: sammanfattning, fyndlista sorterad A→C, grupperad per skärm, varje fynd med bild (beskuren), regel, förslag och insats; dessutom en lista "ser bra ut" så att det syns vad som är granskat.
- `design-review/contact-sheets/*.png` och `design-review/shots/<scene-id>-<theme>.png`.
- Ett förslag till åtgärdsordning: först A-fynd, sedan B-fynd som berör många skärmar (ofta en komponent), sist C.
- Du bestämmer sedan vad som ska fixas; jag kodar inget under granskningen.

## 6. Beslut och arbetssätt (fastställt 2026-11-05)

1. Dev-fliken granskas inte (intern).
2. Windows-specifika delar (fönsterramen, systemmenyn) granskas inte; de går inte att visa under Linux.
3. 150 % DPI: huvudfönstret och tre representativa dialoger (Materials, Options, Place drawing), inte alla.
4. Granskningsskripten checkas in under `packages/desktop/tools/design-review` så att granskningen kan köras om.

**Arbetssätt under och efter granskningen**

- **Småfel fixas direkt** (fel färgtoken, fel versalisering, saknat aria-namn, fel storlek, avhuggen text, inkonsekvent knapprad och liknande), med tester, en commit per område och push till main som vanligt. Varje fixat fynd står kvar i rapporten med "fixat i <commit>" och en före/efter-bild.
- **Större frågor med flera rimliga lösningar** fixas inte på egen hand: rapporten visar 2–3 alternativ som **mockups** (HTML/SVG i samma stil som appen, ljust och mörkt), med för- och nackdelar och en rekommendation, så att vi väljer tillsammans.
- **Rapporten levereras i HTML-format** (`report.html`, självbärande med inbäddade bilder): sammanfattning, fixade fynd, öppna fynd A→C per skärm med bild/regel/förslag/insats, alternativ med mockups, och "ser bra ut".
- Granskningen kan köras utan att någon väntar: den går vidare tills den är klar och rapporterar först i slutet.

## 7. Att köra om granskningen

```
# från repots rot, i en container som root, under virtuell skärm (ImageMagick behövs för kontaktkartorna och About-rutan)
CSLOPE_CAPTURE_NO_SANDBOX=1 xvfb-run -a -s "-screen 0 3000x2000x24" bun packages/desktop/tools/design-review/run.ts
bun packages/desktop/tools/design-review/check.ts      # automatiska regelkontroller → findings-auto.json
bun packages/desktop/tools/design-review/sheets.ts     # kontaktkartor för den visuella granskningen
```

Resultat hamnar i `design-review-out/` (ignoreras av git): `shots/<scen>-<tema>.png`, `metrics/<scen>-<tema>.json`, `index.json`, `findings-auto.json`, `sheets/<område>-<tema>-<n>.png`, och `errors/` med en bild av läget när en scen misslyckades.

- `DESIGN_REVIEW_ONLY=win-materials,ctx-` kör bara scener vars id börjar så (index.json behåller de andra scenernas rader).
- `DESIGN_REVIEW_SKIP_BUILD=1` återanvänder senaste bygget i `packages/desktop/dist`.
- `DESIGN_REVIEW_PORT` sätter felsökningsporten (standard 9341).

**150 %** (scener med `also150`: huvudfönstret i redigerings- och resultatläge, Materials, Options, Place drawing): DevTools-emuleringens skalfaktor ändrar inte vilken skala skärmdumpen ritas i (#43), så 150 %-bilderna tas i en egen app-instans startad med `--force-device-scale-factor=1.5` på en egen virtuell skärm på 1920 × 1080 (1280 × 720 DIP, som en Windows-laptop på 150 %). `run.ts` kör det passet själv efter 100 %-passet; det går också att köra ensamt (det återanvänder senaste bygget):

```
CSLOPE_CAPTURE_NO_SANDBOX=1 DESIGN_REVIEW_SCALE=1.5 xvfb-run -a -s "-screen 0 1920x1080x24" bun packages/desktop/tools/design-review/run.ts
```

`DESIGN_REVIEW_NO_150=1` hoppar över det. Passet avbryts om sidan inte rapporterar skala 1,5 på en 1280 × 720-skärm. Varje bild får i `index.json` den uppmätta skalan (`dpr` från sidan, `pngScale` från PNG-filen); avviker någon från passets skala blir det ett fel. Passet simulerar ett aktivitetsfält på 48 DIP (`CSLOPE_CAPTURE_TASKBAR`): appen begränsar sina fönster till en arbetsyta som är så mycket lägre än skärmen (#48). Dialogfönstren behåller den storlek appen ger dem, så ett fönster som är högre än skärmen syns, och `check.ts` rapporterar det (`taller-than-screen`), också när fönstret bad om mer än arbetsytan och systemet klämde det (appen sparar begärd och given storlek i `window.__CSLOPE_WINDOW_SIZE__`, mätningen tar med den), liksom en rullningslist utan något att rulla (`scroll-bar-without-overflow`, #42).

Filerna: `scenes.ts` (inventeringen: varje scen öppnar sin del med riktiga klick), `run.ts` (startar appen, laddar om sidan före varje bild och startar om appen var tionde scen), `lib.ts` (start, fönster, butik och mätningar inklusive axe-core), `check.ts`, `sheets.ts`.
