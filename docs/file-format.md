# The cSlope project file (.cslp)

This is the specification of the `.cslp` project file, format version 1. The reader and writer the app uses are `packages/desktop/src/features/project/cslp.ts` (with `zip.ts`, `canonical-json.ts` and `input-hash.ts` beside it); `packages/desktop/scripts/check-project.ts` opens a file and prints what it holds, and the Python package reads one with `cslope.project.read` (no engine needed). The user documentation is `packages/website/src/docs/file-format.mdx`.

The words *must*, *must not* and *may* are used in their usual normative sense. A *reader* is any program that opens a project file; a *writer* any program that saves one.

## 1. Container

A project file is a ZIP archive (PKWARE APPNOTE, version 2.0 features only):

- no ZIP64, no encryption, no multi-disk archives, no data descriptors;
- entry names in UTF-8 (general purpose flag bit 11), with `/` as the separator and no leading `/`, `./` or `..` components;
- every entry is either *stored* (method 0) or *deflated* (method 8);
- a reader must not take the file's extension as evidence of its content: a project file is recognised by its first four bytes (`PK\x03\x04`) and its `manifest.json`.

Layout (the entries in the order a writer writes them; the optional ones only when there is something to write):

```
<name>.cslp
├── manifest.json                 the format and its version, who wrote the file and when
├── project.json                  the project: schema version, the models' order, the active model, units
├── models/<id>/model.json        one model, without the outcome of its run
├── models/<id>/result.json       the outcome of its run (optional)
├── models/<id>/backgrounds.json  the drawings placed under it (optional)
├── assets/index.json             the attachments (optional, with assets/)
├── assets/<id>.<ext>             the attachments themselves
└── thumbnail.png                 the active model's result sheet, small (optional)
```

The model folders come in the order of `project.json`'s `models`; within a folder, `model.json`, `result.json`, `backgrounds.json`. The attachments come in the order of their ids (sorted as strings). `thumbnail.png` is last. The writer deflates every JSON entry and `thumbnail.png` is stored; an attachment is stored when its type is compressed already (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`, `application/zip`) and deflated otherwise. A reader must accept either method for any entry.

Every entry carries the same DOS date and time in its local and central headers: the manifest's `modified`, in the writer's local time, to 2 s. (A writer that writes an archive for comparison only may use any constant; the first `.cslp` layout wrote 0.)

Limits a reader enforces, before anything is unpacked: the file is at most 500 MB (its drawings are stored in it, up to 100 MB each); an entry may declare at most 100 MB uncompressed; the deflated entries actually unpacked may declare at most 200 MB together (a stored entry is a copy of bytes the file holds, so it cannot unpack to more than the file's size; the writer stores the drawings). An entry that unpacks to more than its central directory declares is damaged, and the reader stops at the declared size. A reader reads the central directory, unpacks the JSON entries it needs, and leaves the attachments and the thumbnail until they are asked for.

## 2. JSON entries

Every JSON entry is a UTF-8 text without a byte order mark, and a writer writes it canonically:

- the members of every object in the sorted order of their keys (code unit order, as JavaScript's default sort gives it);
- 2-space indentation, as `JSON.stringify(value, null, 2)` lays it out, one array element or object member per line;
- `\n` line ends, and one `\n` after the closing brace;
- numbers as `JSON.stringify` gives them (shortest round-trip form; no `+`, no leading zeros, exponent as `1e21`); a non-finite number is written as `null`;
- no member whose value is `undefined`.

So the same project saved twice, with the same `modified`, is byte for byte the same file, and two saves can be compared line by line. A reader must accept any valid JSON (other key orders, other white space) all the same.

### 2.1 Unknown members and forward compatibility

A reader must ignore any member it does not know, in any JSON entry, and must not carry it over to a file it writes. A reader must ignore entries it does not know (other names, other folders). A writer must not write members or entries that this document does not define under the format version it declares.

## 3. Versioning

`manifest.json` carries two integers:

- `formatVersion`: the version of this layout. It rises only on a change an older reader cannot ignore (a file an older reader would misread, not just read incompletely). This document describes version 1.
- `minReaderVersion`: the oldest format version a reader must understand to read this file correctly. A reader whose newest known format version is below `minReaderVersion` must refuse the file with a message that names the writer: *This project was saved by a newer cSlope (<generator>); update to open it.* A reader must open a file whose `formatVersion` is newer than its own as long as `minReaderVersion` is not, ignoring what it does not know.

The project's own content has a second version, `project.json`'s `version`: the schema of the models (the app's `PROJECT_FILE_VERSION`), with the migrations a reader applies to older models (see 4.2). The two are independent: the schema version rises when a model's meaning changes, the format version when the archive's layout does.

## 4. The entries

### 4.1 manifest.json

```json
{
  "appVersion": "0.1.0-beta.2",
  "created": "2026-11-04T09:00:00.000Z",
  "format": "cslope-project",
  "formatVersion": 1,
  "generator": "cSlope 0.1.0-beta.2",
  "minReaderVersion": 1,
  "modified": "2026-11-04T10:00:00.000Z"
}
```

| Member | Type | Meaning |
| --- | --- | --- |
| `format` | string | Always `"cslope-project"`. A reader refuses any other value. |
| `formatVersion` | integer ≥ 1 | The layout's version (section 3). Required. |
| `minReaderVersion` | integer ≥ 1 | The oldest reader that may read the file (section 3). Required from format 1 on; a reader takes a missing value as `formatVersion`. |
| `appVersion` | string | The version of the program that saved the file (`"unknown"` when it has none). |
| `created` | string, ISO 8601 (UTC, as `Date.toISOString`) | When the project file was first saved. Kept over saves: a reader passes it to the project (`created`), and a writer writes the project's value, or `modified` for a project never saved before. |
| `modified` | string, ISO 8601 | When this file was saved. |
| `generator` | string | The program and version that saved the file, for messages: `"cSlope <appVersion>"`. |

### 4.2 project.json

```json
{
  "activeModelId": "model-2",
  "models": [
    "model-1",
    "model-2"
  ],
  "settings": {},
  "units": "SI",
  "version": 3
}
```

| Member | Type | Meaning |
| --- | --- | --- |
| `version` | integer ≥ 1 | The project schema version: `PROJECT_FILE_VERSION` in `packages/desktop/src/store/persistence.ts`, whose comment lists what each version changed. A reader migrates older models up to its own version; a file without one is version 1. |
| `activeModelId` | string | The id of the model shown when the project opens. A reader takes the first model when it names none. |
| `models` | array of strings | The models' ids in order; each must have a folder `models/<id>/`. A reader refuses a file that names a model without `models/<id>/model.json`, and appends (in name order) any model folder the list does not name, so nothing in a file is lost. |
| `units` | `"SI"` | The unit system of every number in the file: metres, kN, kPa, kN/m³, degrees. Only `"SI"` is defined; a reader refuses any other value rather than misread the numbers. |
| `settings` | object | Project-wide settings. None are defined in format 1; a writer writes `{}`. |

### 4.3 models/\<id\>/model.json

One model, as the app's `ModelEntry` (`packages/desktop/src/store/types.ts`) without the run fields `runState`, `progress`, `result`, `errorMessage` (they belong to `result.json`) and without `backgrounds` (`backgrounds.json`). The folder name is the model's id; `model.json` repeats it in `id`, and the folder name wins when they differ.

A reader validates every member by name as the app does for a JSON project (`parseProjectData` in `persistence.ts`): a member of the wrong shape is dropped or replaced by its default, an unknown member is dropped. The members of a model are, in brief:

| Member | Content |
| --- | --- |
| `id`, `name`, `orientation` (`"ltr"` or `"rtl"`) | identity and the direction of sliding |
| `projectInfo` | title block: `title`, `subtitle`, `client`, `projectNumber`, `revision`, `author`, `checker`, `date`, `description`, `canvasWidth`, `canvasHeight` |
| `coordinates`, `coordinateExpressions`, `parameters` | the ground surface `[x, y][]`, its expressions and the parameters they use |
| `materials`, `materialBoundaries`, `regionMaterials` | the materials (each with a `model` of the engine's `MaterialModel`), the boundaries between layers, the material of each region |
| `piezometricLine`, `waternet` | water: the piezometric lines (with `freeWater`, `mainLineId`, `rapidDrawdown`), head and reference lines |
| `udls`, `lineLoads` | distributed and line loads |
| `reinforcements`, `piles` | reinforcement and piles |
| `customSearchPlanes`, `customPlanesOnly`, `blockSearchObjects`, `analysisLimits` | the search: custom surfaces, block search objects, entry and exit ranges |
| `options` | the engine's `AnalysisOptions` (method, slices, tolerances, partial factors, seismic loads, finite element settings, 3D effects) |
| `earlierStage`, `importNotes` | an earlier construction stage; what an import from another program's file noted |
| `editViewOffset`, `editViewScale`, `resultViewOffset`, `resultViewScale`, `viewOffset`, `viewScale`, `mode` | the views |
| `resultViewSettings` | the result sheet: annotations, paper frame, extents, what is drawn |

The user documentation (`packages/website/src/docs/file-format.mdx` and the reference pages it links) describes the meaning of these; the TypeScript types are the exact schema.

### 4.4 models/\<id\>/result.json

The outcome of the model's last analysis. Absent when the model has no outcome (never run, or still running when saved).

```json
{
  "engine": {
    "sourceHash": "00e5e7acb74d2a35cfdc256137ad128deb4f8e7a14a8ca1d38ce1e056c88d02d",
    "version": "0.1.0"
  },
  "errorMessage": null,
  "inputHash": "4b1c…e9",
  "result": { "minFOS": 1.25, "method": "Bishop", "allSurfaces": [], "criticalSlices": [], "criticalSurface": null, … },
  "runState": "done"
}
```

| Member | Type | Meaning |
| --- | --- | --- |
| `runState` | `"done"` or `"error"` | What the analysis ended in. A reader ignores a `result.json` with any other value. |
| `result` | the engine's `AnalysisResult`, or `null` | The result when `runState` is `"done"`: `minFOS`, `maxFOS`, `method`, `criticalSurface`, `allSurfaces`, `criticalSlices`, `elapsedMs`, warnings, and the optional `fem`, `sgi3d` and reliability parts. A reader drops a result of another shape (the model opens without one). |
| `errorMessage` | string, or `null` | The message when `runState` is `"error"`. |
| `inputHash` | string, 64 lowercase hex digits | The hash of the model's analysis input the result was computed for (section 5). |
| `engine` | object | The engine that computed it: `version` (the engine package's version) and `sourceHash` (the SHA-256 of the engine's sources, `packages/engine/src/wasm/BUILD-INFO.json`); empty strings when unknown. |

The outcome is read from `result.json` only: run fields in `model.json` are ignored. A reader keeps a result whose `inputHash` differs from the model's current input (the file may have been edited by hand, or the hash's definition may have changed between versions); it may show it as out of date. `check-project.ts` reports it.

### 4.5 models/\<id\>/backgrounds.json

The drawings placed under the model: each an attachment of the file (an image, or a page of a PDF), optionally cropped, placed in the model by a 2D affine transform. A JSON array; absent when the model has none. The same attachment may be placed by several models, each with its own page, crop and calibration; the attachment is written once.

```json
[
  {
    "assetId": "5b1e0f6a-2c4d-4e8f-9a1b-3c5d7e9f1a2b",
    "calibration": {
      "axes": {
        "x": [{ "source": [85.04, 425.2], "value": 0 }, { "source": [651.97, 425.2], "value": 40 }],
        "y": [{ "source": [85.04, 425.2], "value": 0 }, { "source": [85.04, 141.73], "value": 10 }]
      },
      "mode": "axes",
      "points": []
    },
    "crop": { "x0": 56.69, "x1": 680.31, "y0": 42.52, "y1": 453.54 },
    "id": "drawing-a",
    "name": "Section A-A",
    "opacity": 0.5,
    "order": 0,
    "page": 1,
    "showInResults": true,
    "transform": { "a": 0.0706, "b": 0, "c": 0, "d": -0.0353, "e": -6, "f": 15 },
    "visible": true
  }
]
```

*Source units* are the drawing's own coordinates, with the origin at the top-left corner of the page (or image) and y downwards: pixels of an image, points (1/72 in) of a PDF page as it is displayed (its `/Rotate` applied, its crop box as the page). *Model coordinates* are metres, y upwards.

| Member | Type | Meaning |
| --- | --- | --- |
| `id` | string matching `[A-Za-z0-9_-]+` | The placement's id, unique within the model (the model's `locks.backgrounds` refers to it). A reader gives an entry without a valid id `drawing-<n>` (n its position, from 1) and makes repeated ids unique. |
| `assetId` | string | The id of an entry of `assets/index.json`. A placement whose attachment is not in the index is dropped on read. |
| `transform` | object `{ a, b, c, d, e, f }` of numbers | The placement: model = M · source, `x = a·u + c·v + e`, `y = b·u + d·v + f` for a source point (u, v). Required; a reader drops an entry whose transform is not finite or is singular (`a·d − b·c` nearly 0). |
| `page` | integer ≥ 1 | The page of a PDF (or the image of a multi-page TIFF), from 1. Absent: the first. |
| `crop` | object `{ x0, y0, x1, y1 }` of numbers | The part of the page shown, in source units. Absent: the whole page. A reader orders the corners and drops an empty rectangle. |
| `calibration` | object | How the transform was found, so that it can be changed later; a reader does not recompute the transform from it. `mode`: `"points"` (two or more source → model point pairs: two give a similarity, three or more a least-squares affine), `"axes"` (two ticks on each axis with their values, x and y scaled separately, no rotation), `"scale"` (one point pair, the origin, and a scale) or `"drawing"` (the transform as stored, without inputs). `points`: an array of `{ "source": [u, v], "model": [x, y] }`. `axes` (axes mode): `{ "x": [{ "source": [u, v], "value": x }...], "y": [...], "reuseFrom"?: "<model id>/<placement id>" }` (with `reuseFrom`, one tick per axis and the other placement's scales). `scale` (scale mode): `{ "metersPerUnit": number > 0, "unit": "px" \| "pt" \| "mm" }`, the scale as typed (1 mm = 72/25.4 pt). A missing or unknown `mode` reads as `"drawing"`. |
| `name` | string | A name of the user's. Absent: the attachment's `originalName` (with the page). |
| `opacity` | number, 0 to 1 | Default 1; clamped. |
| `visible` | boolean | Default true. |
| `order` | number | Drawing order among the model's drawings, lowest first (drawn first); default the entry's position. |
| `showInResults` | boolean | Also drawn in the result view and the PDF export. Default false. |

Whether a placement is locked on the canvas is part of the model: `locks.backgrounds` in `model.json` (an array of placement ids); a reader drops ids of placements the model does not have.

**The first form.** Files written before placements had calibrations hold entries whose `transform` is `{ originX, originY, scale, rotationDeg?, mirrored? }`: the model coordinates (m) of the image's bottom-left corner, metres per pixel (> 0), a rotation counter-clockwise about that corner (degrees, default 0), and a mirror left to right in place before the rotation (default false); without `id` or `calibration`. A reader converts such an entry to the affine transform with the image's size (W × H pixels, read from the image's header): with s the scale, the local placement `x' = s·u` (mirrored: `s·(W − u)`), `y' = s·(H − v)`, rotated by the angle and moved to the origin; `calibration` becomes `{ "mode": "drawing", "points": [] }`. When the image's size cannot be read, H and W are taken as 0. A writer writes the form above only.

The new members are optional additions an older reader ignores (section 2.1): it drops a placement whose transform it does not know (it reads the file incompletely, not wrongly), so the format version stays 1.

### 4.6 assets/index.json and assets/\<id\>.\<ext\>

The attachments: a JSON array, one entry per file under `assets/`. Absent (with the folder) when there are none. A writer writes only the attachments some model refers to (today: from `backgrounds.json`), each once however many placements refer to it; the others are dropped at save. The app places PNG, JPEG, TIFF and PDF files (at most 100 MB each) and tells the type from the bytes, not the name.

```json
[
  {
    "addedAt": "2026-11-04T09:30:00.000Z",
    "bytes": 70,
    "id": "0c8f4a2e-6b1d-4f3a-9e7b-2d5c8a1f6e43",
    "mime": "image/png",
    "originalName": "section.png",
    "path": "assets/0c8f4a2e-6b1d-4f3a-9e7b-2d5c8a1f6e43.png",
    "sha256": "…"
  }
]
```

| Member | Type | Meaning |
| --- | --- | --- |
| `id` | string matching `[A-Za-z0-9_-]+` | The attachment's id; a UUID for new attachments. Unique in the index (a repeated id: the first entry counts). |
| `path` | string | The entry's name: `assets/<id>.<ext>`, with the extension of the type (`png`, `jpg`, `webp`, `gif`, `bmp`, `tif`, `svg`, `pdf`; `bin` for other types). |
| `mime` | string | The media type. |
| `bytes` | integer | The size in bytes. It must equal the size the archive declares for the entry; a reader drops an entry that does not match, as it drops one whose `path` does not exist or does not name its `id`. |
| `sha256` | string, 64 lowercase hex digits | The SHA-256 of the bytes. A reader checks it when the attachment is read, and refuses the attachment (not the project) when it does not match. |
| `originalName` | string | The name the file had when it was attached. |
| `addedAt` | string, ISO 8601 | When it was attached. |

### 4.7 thumbnail.png

A PNG of the active model's result sheet, about 320 px wide, stored. Written when the result view is on screen and drawing it takes at most about 100 ms; otherwise left out. A reader must not rely on it.

## 5. The input hash

`inputHash` in `result.json` is the SHA-256, as 64 lowercase hex digits, of the UTF-8 bytes of the canonical JSON (section 2) of

```json
{ "definition": <definition>, "options": <options> }
```

where `definition` is the engine's `SlopeDefinition` of the model in canonical orientation, exactly as the app sends it to the engine (`buildSlopeDTOFromModel` in `packages/desktop/src/store/helpers.ts`: the ground surface, the materials with their engine names, the water, loads, reinforcement, piles, boundaries and region assignments, the search limits, an earlier stage), and `options` is the model's `options` as saved. Nothing else of the model (its name, views, annotations, result settings) is in it. The one implementation is `analysisInputJson` / `analysisInputHash` in `packages/desktop/src/features/project/input-hash.ts`.

## 6. Model ids

A model's id names its folder, so it must match `[A-Za-z0-9_-]+`. The app gives new models ids of the form `model-<UUID>`. A model with any other id (a hand-edited file) is given a new UUID when the project is opened or saved, and `activeModelId` follows; nothing else in a project refers to a model by its id.

## 7. Files of earlier versions

Readers open two earlier formats and convert them on read; a save writes the layout above (a project opened from a `.json`/`.cslope` file is saved under a new name, next to the old file).

- **JSON project** (`.json`, `.cslope`; cSlope up to 0.1.0-beta.2): a single UTF-8 JSON object, with or without a byte order mark, `{ "version", "activeModelId", "models": [ModelEntry with its run fields] }`; a file without `version` is schema version 1. Recognised by its content: the first non-blank character is `{`.
- **The first .cslp layout** (never released): `manifest.json` (`format`, `formatVersion: 1`, `appVersion`, `created`), `project.json` with the models in an array (without run fields) and `results.json` `{ "models": { "<id>": { "runState", "result", "errorMessage" } } }`. Recognised by a `.cslp` archive without any `models/<id>/model.json` entry whose `project.json` has a `models` array.

The test fixtures in `packages/desktop/src/features/project/fixtures/` hold one small file of each format that must stay readable: `legacy-json-v1.json`, `legacy-json-v3.json`, `cslp-3file.cslp`, `cslp-v1.cslp` (this layout, with a background of the first form of `backgrounds.json`) and `cslp-v1-drawings.cslp` (this layout with one PDF placed in two models, page 1 and page 2, made by `scripts/make-project-fixture.ts`).

## 8. Saving

The app saves atomically: the archive is written to `<file>.tmp-<random>` next to the target, flushed, and renamed over the target; on failure the temporary file is deleted and the target is untouched. On Windows, when the target cannot be replaced because another program holds it, the file is written in place instead.

Results are optional on save (`writeProjectArchive(file, { results: false })` writes the project without any `result.json`); the app always writes them.
