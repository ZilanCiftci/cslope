# Hemsidan: implementeringsplan

Plan för en total översyn av `packages/website`. Målgruppen är ingenjörsfirmor
som ska ladda ner och lita på cSlope. Planen bygger på en genomgång av
paketet, appens faktiska funktioner och den befintliga bildpipelinen.

Statusmarkeringar: `[ ]` ej påbörjad, `[~]` pågår, `[x]` klar.

---

## 1. Nuläge

### 1.1 Vad som finns

| | |
|---|---|
| Stack | Vite 7, React 19, Tailwind 4, shadcn-liknande komponenter (button, card, separator), framer-motion, react-router 7, lucide-react |
| Storlek | ~1 200 rader, 2 sidor (`/` och `/docs`) |
| Bygge | `bun run build` fungerar (396 kB JS, 29 kB CSS). Lint och typecheck är rena. |
| Tema | shadcn-standardpaletten (slate) i ljust och mörkt läge, med växlare |
| Bilder | Inga. `public/` innehåller bara `mountain.svg` |
| Deploy | Ingen. Inget workflow, ingen `base`, ingen domän. Sidan är inte publicerad någonstans. |
| CI | Lint och typecheck körs via `bun run --filter '*'`, men inte bygget |
| README | Vites mall, oförändrad |

### 1.2 Problem

**Innehållet säger fel saker om appen.**

- "Analysis methods: 3", "circular slip surfaces". Appen har Bishop, Janbu
  (med f0), Spencer och Morgenstern–Price (GLE), icke-cirkulära ytor med
  optimering, dragsprickor, partialkoefficienter, förstärkning, pålar,
  kalkcementpelare, känslighets- och sannolikhetsanalys. Inget av det nämns.
- "Download preview build" länkar till GitHub Releases, som är tom. Knappen
  är sidans enda call-to-action och leder ingenstans.
- "macOS packages are planned once stable", "Electron-based preview". Språket
  signalerar hobbyprojekt, inte ett verktyg att lita på.
- Docs-sidans "Quick Start" ber användaren klona repot och köra `bun run dev`.
  En ingenjör vill ha ett installationsprogram.

**Inga förtroendesignaler.** Det som faktiskt skiljer cSlope från andra
projekt syns inte: 180 verifieringsfall med 365 kontroller mot Slide2,
GeoStudio och publicerad litteratur, deterministiska lösare, 2 800 tester,
över 95 % testtäckning, en genererad verifieringsrapport i PDF.

**Ingen visuell identitet.** Standardpalett, ingen typografi, inga
skärmdumpar, en 24 px logotyp. Sidan ser ut som en mall.

**Ingen dokumentation.** Fyra korta stycken utan bilder.

**Teknisk skuld.**

- Ingen `<meta name="description">`, inga Open Graph-taggar, ingen
  `robots.txt`/`sitemap.xml`, ingen 404-sida.
- `public/mountain.svg` som favicon är en generisk ikon.
- Dokumentationen är hårdkodad JSX. Varje ny sida kräver kodändringar.
- `src/assets/react.svg` är kvar från mallen.

### 1.3 Bildpipelinen (viktig för tutorials)

`packages/desktop/tools/media-capture/` bygger appen med `VITE_CAPTURE_MODE=1`,
startar Electron via Playwright och tar deterministiska skärmdumpar enligt
`packages/website/src/content/media-scenes.ts`. Åtta scener är definierade
(fyra edit-vyer, fyra resultatvyer) av benchmarkmodellerna T-ACADS, Arai &
Tagyo och Talbingo Dam. Utdata: `packages/website/public/media/generated/`
i 1440×900 @2x.

Pipelinen körs i utvecklingscontainern under en virtuell skärm:

```
CSLOPE_CAPTURE_NO_SANDBOX=1 xvfb-run -a -s "-screen 0 1440x900x24" bun run media:capture
```

`CSLOPE_CAPTURE_NO_SANDBOX` lades till i `capture-runner.ts` eftersom
Chromium vägrar köra som root med sandlådan på. De åtta scenerna är tagna
och incheckade. Två brister att rätta när scenerna byggs ut:

- `edit-geometry` och `edit-water-table` är identiska bilder; scenen för
  vattenytan saknar en egen inställning som gör linjen synlig.
- På `edit-dam` krockar koordinatetiketterna vid krönet. Scenerna behöver
  kunna stänga av etiketterna.

Scen-typerna stöder i dag bara `mode`, `runAnalysis` och
resultatvy-inställningar; för tutorials behöver de utökas (öppna dialoger,
aktiv sektion i Explorer, markerade punkter, `crop: "full"` för hela
fönstret).

---

## 2. Mål och målgrupp

**Primär målgrupp:** geotekniker på konsultfirmor som i dag använder
Slide2, GeoStudio eller GeoSuite och som ska avgöra om cSlope är värt att
testa.

**Vad de vill veta, i ordning:**

1. Vad kan programmet? (metoder, modeller, laster, vatten, förstärkning)
2. Kan jag lita på resultaten? (verifiering mot kända lösningar)
3. Hur ser det ut? (skärmdumpar, inte löften)
4. Hur kommer jag igång? (installation, första modellen på 10 minuter)
5. Vad kostar det, och vem står bakom? (MIT, öppen källkod, kontakt)

**Mål för sidan:**

- En besökare ska kunna svara på alla fem frågor inom två minuter.
- Dokumentationen ska täcka varje meny i appen med minst en bild.
- Innehåll ska vara data, inte kod: nya sidor i Markdown.
- Sidan ska publiceras automatiskt vid push till `main`.

**Språk:** engelska. Appens gränssnitt är på engelska, och målgruppen
är internationell. Svenska kan läggas till senare som en översättning av
utvalda sidor, men inte nu.

**Inga konkurrentnamn.** Hemsidan, dokumentationen och den publicerade
verifieringsrapporten nämner inga andra program vid namn, varken i text,
tabeller, bildtexter eller alt-texter. Verifieringsfall anges med
litteraturkälla (författare och år) när en finns. Fall som bara kommer
från en leverantörs verifieringsmanual anges som "verification manual of
a commercial slope stability program". Regeln gäller också `media-scenes`,
benchmark-titlar som visas på sidan och frontmatter i docs. Ett test i
website-paketet söker igenom allt byggt innehåll efter en lista med
förbjudna namn och fallerar bygget om något hittas.

---

## 3. Informationsarkitektur

```
/                         Startsida
/features                 Funktioner, en sektion per område, med bilder
/verification             Verifiering: tabell över alla fall, länk till PDF
/download                 Nedladdning, systemkrav, installation, versioner
/docs                     Dokumentation (egen layout med sidomeny)
  /docs/getting-started   Installation och första modellen
  /docs/geometry          Geometri, gränser, DXF, parametrar
  /docs/materials         Material och hållfasthetsmodeller
  /docs/water             Vatten och portryck
  /docs/loads             Laster
  /docs/search            Sökning efter glidyta
  /docs/analysis          Metoder och analysalternativ
  /docs/reinforcement     Förstärkning och pålar
  /docs/results           Resultat, annoteringar, export
  /docs/sensitivity       Känslighets- och sannolikhetsanalys
  /docs/file-format       Projektfilens format
  /docs/tutorials/…       Steg-för-steg-guider med bilder
/changelog                Versionshistorik
/about                    Om projektet, licens, kontakt
```

Huvudmenyn: Features · Verification · Docs · Download · GitHub.

---

## 4. Design

### 4.1 Riktning

Tekniskt, lugnt och exakt. Förebild: dokumentationssajter för
ingenjörsverktyg, men renare; inte SaaS-landningssidor. Inga animerade gradienter, inga "READY WHEN YOU ARE".
Bilderna gör jobbet.

### 4.2 Visuell identitet

- **Färg:** en egen palett i stället för shadcn-standard. Förslag: mörk
  blågrå som primär (jordmaterial, ritningskänsla), en varm accent för
  glidytor (samma röda som i logotypen, `#dc2626`), neutrala gråtoner.
  Definieras som tokens i `index.css` för ljust och mörkt läge.
- **Typografi:** en sans för rubriker och brödtext (t.ex. Inter eller
  IBM Plex Sans), monospace för tal, filnamn och kod (IBM Plex Mono eller
  JetBrains Mono). Tal i tabeller med `font-variant-numeric: tabular-nums`.
- **Logotyp:** behåll idén (slänt + glidcirkel) men rita om i större format
  för hero och OG-bild. Exportera favicon i PNG/ICO/SVG.
- **Bilder:** skärmdumpar @2x med tunn ram och svag skugga, i både ljust
  och mörkt läge om appen stöder det; annars ljust.
- **Rörelse:** ta bort framer-motion från innehållet. En enkel
  fade-in på hero räcker, med CSS.

### 4.3 Komponenter att bygga

| Komponent | Används på |
|---|---|
| `SiteHeader`, `SiteFooter` | alla sidor |
| `Hero` med skärmdump | start |
| `FeatureSection` (text + bild, växlande sida) | features |
| `MethodsTable` | start, analysis |
| `VerificationTable` (filtrerbar) | verification |
| `DownloadCard` (OS, version, storlek, SHA-256) | download |
| `DocsLayout` (sidomeny, innehållsförteckning, föregående/nästa) | docs |
| `Callout` (note, warning, tip) | docs |
| `Figure` (bild + bildtext + zoom) | docs, features |
| `Steps` (numrerade steg med bild per steg) | tutorials |
| `NotFound` | 404 |

---

## 5. Innehåll per sida

### 5.1 Startsida

1. **Hero.** Rubrik: "Slope stability analysis you can verify." Underrubrik
   med en mening om vad programmet gör. Två knappar: Download, Read the
   docs. En stor skärmdump av resultatvyn (scen `result-critical-surface`).
2. **Nyckeltal, med riktiga siffror.** 180 verification problems ·
   365 checks against published results · 4 limit equilibrium methods ·
   MIT licensed. Siffrorna hämtas från engine vid bygge (se §7.4), inte
   hårdkodas.
3. **Funktioner i korthet.** Sex kort som länkar till `/features`:
   Methods, Geometry & materials, Water, Reinforcement & piles, Search,
   Results & reporting.
4. **Verifiering.** Kort sektion: "Every release is checked against
   published solutions." Tre exempel med litteraturkälla, vårt värde,
   publicerat värde och avvikelse. Länk till `/verification`.
5. **Skärmdumpar.** Tre till fyra bilder i ett galleri.
6. **Öppen källkod.** Vad MIT betyder för en firma: ingen licensserver,
   ingen inlåsning, koden går att granska.
7. **Download-sektion.** Windows-installer, macOS, Linux, med version.

### 5.2 Features

En sektion per område, med bild och punktlista. Underlag finns i appens
menyer:

- **Geometry:** exterior/interior boundaries, snapping, DXF import,
  parameters with expressions, undo/redo.
- **Materials:** Mohr–Coulomb, undrained, Su = f(depth) (från marken eller
  lagrets överkant), Su = f(datum), hållfasthetstak, anisotropic, spatial,
  lime-cement columns, saturated unit weight.
- **Water:** piezometric lines per material, ponded water, water in
  tension cracks, water pressure.
- **Loads:** UDL, line loads.
- **Search:** grid and radius search, search limits, custom planes,
  non-circular optimisation, minimum slip depth, both slip directions.
- **Analysis:** Bishop, Janbu with f0, Spencer, Morgenstern–Price with
  selectable interslice functions, tension cracks (fixed and automatic),
  partial factors (EC7/IEG).
- **Reinforcement & support:** anchors, soil nails, geosynthetics, sheet
  piles, piles, lime-cement columns.
- **Results:** critical or all surfaces, FOS filter, slices, annotations,
  templates, Fm/Ff vs λ plot, slice table, Excel and PDF export.
- **Sensitivity & probability:** sensitivity sweeps, Taylor series and
  Monte Carlo with correlations.

### 5.3 Verification

- Inledning: vad som verifieras och mot vad (publicerade artiklar och
  böcker, verifieringsmanualer för kommersiella program, utan namn).
- Tabell: id, titel, metod, vårt värde, publicerat värde, källa, avvikelse.
  Filtrerbar på källtyp och metod. Genereras från engine-data vid bygge,
  med källfältet mappat genom en anonymiseringstabell (§7.4).
- Länk till verifieringsrapporten i PDF. Rapportgeneratorn
  (`bun run verification-report` i desktop-paketet) får ett läge
  `--public` som använder samma anonymisering. Den publicerade PDF:en
  byggs bara i det läget.
- Avsnitt om testning: antal tester, täckning, CI.

### 5.4 Download

- Ett kort för Windows med version, filnamn, storlek och SHA-256.
  macOS och Linux visas som "coming" utan knapp tills de byggs.
- Systemkrav.
- Installationsanvisning i tre steg, med bild av SmartScreen-dialogen
  om installern inte är signerad.
- Länk till alla versioner på GitHub Releases.
- Kräver ett release-workflow (§7.8) och en första tagg `v0.1.0`.

### 5.5 Docs

Se §6.

### 5.6 About

"cSlope is developed by Ibirico" med länk till ibirico.se. Varför det är
öppen källkod, hur man rapporterar fel (GitHub Issues), kontakt via en
e-postadress på ibirico.se. Licenstext. Samma avsändare i sidfoten på
alla sidor.

---

## 6. Dokumentation och tutorials

### 6.1 Struktur

Två typer av sidor:

- **Referens** (`/docs/<område>`): beskriver varje dialog, varje fält och
  vad det gör. Skrivs per meny i appen så att inget missas.
- **Tutorials** (`/docs/tutorials/<namn>`): steg för steg med en bild per
  steg, från tom modell till resultat.

### 6.2 Tutorials att skriva

| # | Titel | Modell | Bilder (ca) |
|---|---|---|---|
| 1 | Your first analysis in 10 minutes | T-ACADS Simple | 10 |
| 2 | Layered slope with a water table | Arai & Tagyo | 8 |
| 3 | Importing geometry from DXF | egen | 5 |
| 4 | Non-circular slip surfaces | VP15-liknande | 6 |
| 5 | Reinforcing a slope with nails and geosynthetics | egen | 8 |
| 6 | Dam cross-section with zoned materials | Talbingo Dam | 8 |
| 7 | Partial factors to Eurocode 7 | T-ACADS | 5 |
| 8 | Probabilistic analysis | VP28 | 6 |
| 9 | Reporting: annotations, templates and PDF export | Arai & Tagyo | 8 |
| 10 | Checking a result against a benchmark | valfri | 4 |

Tutorial 1 skrivs först och sätter mallen för de andra.

### 6.3 Bildpipeline

1. Utöka `SceneSetup` i `media-scene-types.ts` med:
   `activeSection`, `openDialog`, `selectedPointIndex`, `explorerOpen`,
   `highlight` (rektangel att rita runt ett UI-element) och
   `crop: "full" | "canvas" | "dialog"`.
2. Utöka `store-capture.ts` så att varje nytt fält kan appliceras på
   storen eller via IPC.
3. Definiera scener per tutorialsteg i `media-scenes.ts`, grupperade med
   ett `tutorial`-fält så att de hamnar i `public/media/tutorials/<namn>/`.
4. Kör bildtagningen i containern (kommandot i §1.3). Checka in bilderna.
   Bilderna är deterministiska, så en `git diff` visar när UI:t ändrats.
   Alla bilder tas i ljust tema; sidan visar samma bild i båda lägena.
5. Lägg till ett CI-steg som bygger appen i capture-läge och verifierar
   att alla scener fortfarande går att köra (utan att jämföra pixlar).

Manuella skärmdumpar undviks. Allt som syns i dokumentationen ska gå att
regenerera.

### 6.4 Format

Markdown med frontmatter (`title`, `description`, `order`), laddat via
`@mdx-js/rollup` så att `Figure`, `Steps` och `Callout` kan användas i
texten. Sidomenyn byggs från filerna med `import.meta.glob`. Varje sida
får en innehållsförteckning från rubrikerna och länkar föregående/nästa.

---

## 7. Teknik

### 7.1 Behåll

Vite, React, Tailwind 4, react-router. Paketet är litet och stacken
fungerar. Inget byte till Astro eller Next.

### 7.2 Lägg till

- `@mdx-js/rollup`, `remark-frontmatter`, `remark-gfm` för dokumentationen.
- `rehype-slug` + `rehype-autolink-headings` för ankare.
- Typsnitt via `@fontsource/*` (lokalt, inga externa anrop).
- Ingen sökfunktion i första versionen; lägg till Pagefind när sidan
  har mer än ~30 sidor.

### 7.3 Ta bort

- framer-motion (−40 kB) och `src/assets/react.svg`.
- Vites README; ersätt med en kort README om hur sidan byggs och hur
  bilder regenereras.

### 7.4 Data från engine

Ett byggskript (`scripts/generate-data.ts`) importerar
`VERIFICATION_CASES` och `RELIABILITY_CASES` från engine, kör dem och
skriver `src/content/generated/verification.json` med alla värden. Sidan
bygger tabellen från filen. Nyckeltalen på startsidan läses från samma
fil. Filen checkas in så att `bun run build` inte behöver köra engine.
Ett CI-steg kontrollerar att filen är aktuell.

Källfältet (`publishedBy` i engine) går genom en anonymiseringstabell i
skriptet: litteraturkällor behålls, leverantörsnamn ersätts med
"commercial program A/B/…" så att läsaren ändå ser att två olika program
gav olika värden. Tabellen är den enda platsen där de riktiga namnen finns
i website-paketet, och den ligger utanför `src/` så att den inte byggs in.

### 7.5 Deploy

Vercel, kopplat till GitHub-repot. `vercel.json` i paketet anger
`buildCommand: "bun run build"`, `outputDirectory: "dist"` och en
rewrite av alla sökvägar till `index.html` för react-router. Root
directory sätts till `packages/website` i Vercels panel. Varje push till
`main` publicerar produktion; pull requests får förhandsvisning. Domänen
läggs till i Vercels panel när den finns; sidan byggs utan `base`.

### 7.6 SEO och delning

- `<title>` och `<meta name="description">` per sida (react-router +
  en liten `useDocumentMeta`-hook).
- Open Graph- och Twitter-taggar med en genererad OG-bild (1200×630).
- `robots.txt`, `sitemap.xml` genererad vid bygge från routerna.
- Riktig favicon i flera storlekar.

### 7.7 Kvalitet

- Lighthouse ≥ 95 på Performance, Accessibility, Best practices, SEO.
- Alla bilder med `alt`, `width` och `height`.
- Vitest med Testing Library för komponenter med logik (sidomeny,
  verifieringstabellens filter, routing). Inga tester för ren layout.
- Ett test som söker igenom `dist/` och alla docs-källor efter förbjudna
  namn (§2) och fallerar om något hittas.
- `bun run build` i CI, inte bara lint och typecheck.

### 7.8 Release-workflow

`release.yml` i `.github/workflows/`: körs på tagg `v*`, bygger
Windows-installern med `bun run package` på `windows-latest`, skapar en
GitHub Release med installern, SHA-256 och en changelog ur
`CHANGELOG.md`. Signering via `sign.cjs` kräver hemligheterna från
`.env.trustedsigning` som repository secrets; utan dem byggs en osignerad
installer och download-sidan visar SmartScreen-anvisningen. macOS och
Linux läggs till i samma workflow senare.

---

## 8. Etapper

Varje etapp ska gå att pusha och publicera för sig.

### Etapp 0: Grund (0,5–1 dag)

- [ ] Rätta fakta på nuvarande sida (metoder, icke-cirkulärt, ta bort
      "preview"-språket) så att inget är fel medan resten byggs.
- [ ] `vercel.json`; du kopplar repot i Vercels panel.
- [ ] Bygg i CI.
- [ ] Testet mot förbjudna namn.
- [ ] Meta description, favicon, `robots.txt`, 404-sida.
- [ ] Ny README för paketet. Ta bort `react.svg`.

### Etapp 1: Identitet och startsida (2–3 dagar)

- [ ] Palett, typsnitt, tokens i `index.css`.
- [ ] Omritad logotyp, OG-bild.
- [ ] `SiteHeader`, `SiteFooter` med ny meny.
- [x] Media-capture för de åtta befintliga scenerna (incheckade i
      `public/media/generated/`).
- [ ] Startsida enligt §5.1.
- [ ] Ta bort framer-motion.

### Etapp 2: Features, Verification, Download, About (2 dagar)

- [ ] `generate-data.ts` med anonymisering, och `verification.json`.
- [ ] `--public`-läge i verifieringsrapporten.
- [ ] `/verification` med filtrerbar tabell och PDF.
- [ ] `/features` med bilder från scenerna.
- [ ] `release.yml` och första taggen `v0.1.0` (Windows).
- [ ] `/download`.
- [ ] `/about` (Ibirico), `/changelog`.

### Etapp 3: Dokumentationsplattform (1–2 dagar)

- [ ] MDX-pipeline, `DocsLayout`, sidomeny, innehållsförteckning,
      föregående/nästa.
- [ ] `Figure`, `Steps`, `Callout`.
- [ ] Flytta nuvarande docs-innehåll till Markdown.
- [ ] Referenssidor för alla områden i §3, text först, bilder när de finns.

### Etapp 4: Tutorials och bilder (löpande, ~1 dag per 2 tutorials)

- [ ] Utöka scen-typerna och `store-capture.ts` (§6.3). Rätta
      vattenyte-scenen och etikettkrocken på dammen.
- [ ] Tutorial 1 med bilder; sätt mallen.
- [ ] Tutorials 2–10.
- [ ] CI-steg som verifierar att scenerna går att köra.

### Etapp 5: Finputs (1 dag)

- [ ] Lighthouse-genomgång.
- [ ] Komponenttester.
- [ ] Mobilgenomgång av alla sidor.
- [ ] Sitemap, OG-taggar per sida.

---

## 9. Beslut

| # | Fråga | Beslut |
|---|---|---|
| 1 | Release | Windows först via release-workflow och tagg `v0.1.0`; macOS och Linux senare. |
| 2 | Värd | Vercel, kopplat till repot. Domän läggs till i Vercel när den finns. |
| 3 | Avsändare | "Developed by Ibirico", länk till ibirico.se, kontakt via e-post på domänen och GitHub Issues. |
| 4 | Bildtagning | Körs i utvecklingscontainern under xvfb; fungerar, åtta scener tagna. |
| 5 | Bildtema | Ljust överallt. |
| 6 | Källor | Litteratur anges med författare och år; leverantörsmanualer anonymiseras. Inga konkurrentnamn någonstans på sidan eller i den publicerade PDF:en. |

Återstår att få från dig, utan brådska: e-postadressen för kontakt, och
domännamnet när det är köpt.

---

## 10. Nästa steg

Etapp 0, sedan etapp 1. Etapp 0 kan gå till `main` samma dag; du
kopplar repot i Vercel när `vercel.json` finns.
