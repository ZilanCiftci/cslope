# Verification log

How each change to the engine or the verification problems moved cSlope's results on the verification problems, for traceability. Add an entry after every change that can move results (see CLAUDE.md):

```
cd packages/website
bun scripts/generate-data.ts
bun scripts/verification-log.ts "Short description of the change"
```

The script compares the regenerated verification table with the committed one and records how long the verification run took (wall time; it depends on the machine and its load). Errors are relative, in percent: against the other programs, the reference is the midpoint of their range for that analysis; against the papers, the published value. The summary lists the changes oldest first; the entries below are newest first.

## Summary

| Date | Change | Results moved | Mean abs. error vs programs | RMS vs programs | Mean abs. error vs papers | RMS vs papers | Verification run time |
|---|---|---|---|---|---|---|---|
| 2026-10-24 | Circular search: circles tangent to material interfaces, seeds per basin (review A3) | 12 | 0.399 → 0.398 | 0.570 → 0.570 | 1.661 → 1.653 | 4.014 → 4.007 | not recorded |
| 2026-10-24 | Warning for Bishop on non-circular surfaces (review B1) | 0 | 0.398 → 0.398 | 0.570 → 0.570 | 1.653 → 1.653 | 4.007 → 4.007 | 168 s (4 workers) |
| 2026-10-24 | Lime-cement columns: each strength part takes its own partial factor; pile force takes the weaker branch (review B3, B9) | 0 | 0.398 → 0.398 | 0.570 → 0.570 | 1.653 → 1.653 | 4.007 → 4.007 | 216 s (4 workers) |
| 2026-10-24 | Slices: water-line corners as slice edges, no head correction at a vertical step; a base on a layer boundary takes the layer below (review B4, C3) | 27 | 0.398 → 0.398 | 0.570 → 0.570 | 1.653 → 1.653 | 4.007 → 4.007 | 87 s (4 workers) |
| 2026-10-24 | Search: entry points behind loads on top of the grid (review C2) | 0 | 0.398 → 0.398 | 0.570 → 0.570 | 1.653 → 1.653 | 4.007 → 4.007 | not recorded |
| 2026-10-24 | Surfaces leaving the model through its base are rejected (review C2) | 0 | 0.398 → 0.398 | 0.570 → 0.570 | 1.653 → 1.653 | 4.007 → 4.007 | not recorded |
| 2026-10-24 | Non-circular optimisation: the best surface is optimised further while it still improves (review C2) | 35 | 0.398 → 0.408 | 0.570 → 0.590 | 1.653 → 1.673 | 4.007 → 4.014 | 90 s (4 workers, load 2.1 at start) |
| 2026-10-24 | Engine default: 500 refined iterations, as the desktop app (review C2) | 0 | 0.408 → 0.408 | 0.590 → 0.590 | 1.673 → 1.673 | 4.014 → 4.014 | 91 s (4 workers, load 3.2 at start) |
| 2026-10-24 | Final review: slicing with dense water lines, weaker soil on a layer boundary, pile pond water | 2 | 0.408 → 0.407 | 0.590 → 0.589 | 1.673 → 1.673 | 4.014 → 4.014 | 91 s (4 workers, load 0.9 at start) |
| 2026-10-24 | Zhu & Lee's simplified Bishop value for surface 3 (V096a, V096c) marked disputed and left out of the statistics; confirmed in the paper | 0 | 0.407 → 0.407 | 0.589 → 0.589 | 1.673 → 1.178 | 4.014 → 1.684 | 88 s (4 workers, load 0.2 at start) |
| 2026-10-24 | Inputs corrected from the night investigation (V082a-c water table, V039/V040 clay 6.5 m, V051 phreatic correction, V087 R = 169.0 ft); Morgenstern-Price returns the interpolated crossing; default tolerance 0.001 | 54 | 0.407 → 0.354 | 0.589 → 0.501 | 1.178 → 1.146 | 1.684 → 1.660 | 88 s (4 workers, load 0.9 at start) |
| 2026-10-24 | Input audit of all verification problems: V005, V009a-c, V017a/b, V029, V042, V060a, V061, V065, V066c, V068, V075, V077, V083, V092, V098 corrected against their sources | 18 | 0.354 → 0.358 | 0.501 → 0.509 | 1.146 → 1.092 | 1.660 → 1.581 | 87 s (4 workers, load 0.9 at start) |
| 2026-10-25 | Ito & Matsui pile force at the resultant of the soil pressure; V084a note on the nail spacing | 3 | 0.358 → 0.349 | 0.509 → 0.498 | 1.092 → 1.092 | 1.581 → 1.581 | 81 s (4 workers, load 0.9 at start) |
| 2026-10-25 | More program values as checks (GLE on V082b/c, V086b/c, V088-V090, V092, V096a/b; Janbu simplified on V085, V093; new V082d search); V095b merged into V095a; V016c block-search values out | 0 | 0.349 → 0.353 | 0.498 → 0.499 | 1.092 → 1.092 | 1.581 → 1.581 | 78 s (4 workers, load 1.0 at start) |
| 2026-10-25 | Block search (opt-in search method; circular search unchanged) | 0 | 0.353 → 0.353 | 0.499 → 0.499 | 1.092 → 1.092 | 1.581 → 1.581 | 90 s (4 workers, load 1.0 at start) |
| 2026-10-25 | Fredlund & Krahn (1977) checked against the paper: Spencer checks, case 6 added (V046b), V046 renamed V046a | 0 | 0.353 → 0.353 | 0.499 → 0.499 | 1.092 → 1.045 | 1.581 → 1.537 | 107 s (4 workers, load 0.3 at start) |
| 2026-10-25 | V091: USACE's chart value is 1.24, not 1.33; V092: USACE's own piezometric line documented; V096d–e: Zhu & Lee's surface 3 on the paper's own circle | 0 | 0.353 → 0.353 | 0.499 → 0.499 | 1.045 → 0.955 | 1.537 → 1.460 | 182 s (4 workers, load 6.0 at start) |
| 2026-10-25 | Review fixes: USACE's V092 values no longer compared on the program's line, one source string per manual and paper; regenerated at idle load | 0 | 0.353 → 0.353 | 0.499 → 0.499 | 0.955 → 0.955 | 1.460 → 1.464 | 100 s (4 workers, load 0.5 at start) |
<!-- summary-end -->

## Entries

<!-- entries -->

### 2026-10-25: Review fixes: USACE's V092 values no longer compared on the program's line, one source string per manual and paper; regenerated at idle load

Compared with b3d773c. Errors are relative to the reference, in percent. Verification run time: 100 s (4 workers, load 0.5 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 280)** | | | | -0.236 % | -0.236 % |
| **Mean absolute error** | | | | 0.353 % | 0.353 % |
| **RMS error** | | | | 0.499 % | 0.499 % |
| **Largest error** | | | | 2.215 % | 2.215 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 101)** | | | | -0.177 % | -0.169 % |
| **Mean absolute error** | | | | 0.955 % | 0.955 % |
| **RMS error** | | | | 1.460 % | 1.464 % |
| **Largest error** | | | | 5.385 % | 5.385 % |


### 2026-10-25: V091: USACE's chart value is 1.24, not 1.33; V092: USACE's own piezometric line documented; V096d–e: Zhu & Lee's surface 3 on the paper's own circle

Compared with b71c422. Errors are relative to the reference, in percent. Verification run time: 182 s (4 workers, load 6.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 280)** | | | | -0.236 % | -0.236 % |
| **Mean absolute error** | | | | 0.353 % | 0.353 % |
| **RMS error** | | | | 0.499 % | 0.499 % |
| **Largest error** | | | | 2.215 % | 2.215 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 102)** | | | | -0.277 % | -0.177 % |
| **Mean absolute error** | | | | 1.045 % | 0.955 % |
| **RMS error** | | | | 1.537 % | 1.460 % |
| **Largest error** | | | | 5.385 % | 5.385 % |


### 2026-10-25: Fredlund & Krahn (1977) checked against the paper: Spencer checks, case 6 added (V046b), V046 renamed V046a

Compared with 4ba0560. Errors are relative to the reference, in percent. Verification run time: 107 s (4 workers, load 0.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 280)** | | | | -0.236 % | -0.236 % |
| **Mean absolute error** | | | | 0.353 % | 0.353 % |
| **RMS error** | | | | 0.499 % | 0.499 % |
| **Largest error** | | | | 2.215 % | 2.215 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 103)** | | | | -0.291 % | -0.277 % |
| **Mean absolute error** | | | | 1.092 % | 1.045 % |
| **RMS error** | | | | 1.581 % | 1.537 % |
| **Largest error** | | | | 5.385 % | 5.385 % |


### 2026-10-25: Block search (opt-in search method; circular search unchanged)

Compared with 06b9ddb. Errors are relative to the reference, in percent. Verification run time: 90 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 280)** | | | | -0.236 % | -0.236 % |
| **Mean absolute error** | | | | 0.353 % | 0.353 % |
| **RMS error** | | | | 0.499 % | 0.499 % |
| **Largest error** | | | | 2.215 % | 2.215 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 97)** | | | | -0.291 % | -0.291 % |
| **Mean absolute error** | | | | 1.092 % | 1.092 % |
| **RMS error** | | | | 1.581 % | 1.581 % |
| **Largest error** | | | | 5.385 % | 5.385 % |


### 2026-10-25: More program values as checks (GLE on V082b/c, V086b/c, V088-V090, V092, V096a/b; Janbu simplified on V085, V093; new V082d search); V095b merged into V095a; V016c block-search values out

Compared with 9be7d99. Errors are relative to the reference, in percent. Verification run time: 78 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 280)** | | | | -0.227 % | -0.236 % |
| **Mean absolute error** | | | | 0.349 % | 0.353 % |
| **RMS error** | | | | 0.498 % | 0.499 % |
| **Largest error** | | | | 2.215 % | 2.215 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 97)** | | | | -0.291 % | -0.291 % |
| **Mean absolute error** | | | | 1.092 % | 1.092 % |
| **RMS error** | | | | 1.581 % | 1.581 % |
| **Largest error** | | | | 5.385 % | 5.385 % |


### 2026-10-25: Ito & Matsui pile force at the resultant of the soil pressure; V084a note on the nail spacing

Compared with 88a95c4. Errors are relative to the reference, in percent. Verification run time: 81 s (4 workers, load 0.9 at start).

**Against other programs (midpoint of their range):** 3 moved (3 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V013c Bishop simplified | 1.430 | 1.4499 | 1.4370 | +1.392 % | +0.490 % |
| V013d Bishop simplified | 1.330 | 1.3417 | 1.3314 | +0.880 % | +0.105 % |
| V013e Bishop simplified | 1.250 | 1.2598 | 1.2528 | +0.784 % | +0.224 % |
| **Mean error (n = 266)** | | | | -0.219 % | -0.227 % |
| **Mean absolute error** | | | | 0.358 % | 0.349 % |
| **RMS error** | | | | 0.509 % | 0.498 % |
| **Largest error** | | | | 2.215 % | 2.215 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 97)** | | | | -0.291 % | -0.291 % |
| **Mean absolute error** | | | | 1.092 % | 1.092 % |
| **RMS error** | | | | 1.581 % | 1.581 % |
| **Largest error** | | | | 5.385 % | 5.385 % |


### 2026-10-24: Input audit of all verification problems: V005, V009a-c, V017a/b, V029, V042, V060a, V061, V065, V066c, V068, V075, V077, V083, V092, V098 corrected against their sources

Compared with 34358d4. Errors are relative to the reference, in percent. Verification run time: 87 s (4 workers, load 0.9 at start).

**Against other programs (midpoint of their range):** 14 moved (3 closer to the reference, 11 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V083 Janbu corrected | 0.890 | 0.8989 | 0.8845 | +1.000 % | -0.618 % |
| V075 Spencer | 0.570 | 0.5994 | 0.5777 | +0.570 % | +1.351 % |
| V042 Spencer | 1.648 | 1.6587 | 1.6491 | +0.649 % | +0.067 % |
| V092 Janbu corrected | 1.830 | 1.8325 | 1.8237 | +0.137 % | -0.344 % |
| V092 Bishop simplified | 2.011 | 1.9981 | 1.9905 | -0.641 % | -1.019 % |
| V092 Spencer | 2.026 | 2.0122 | 2.0047 | -0.681 % | -1.051 % |
| V042 Bishop simplified | 1.584 | 1.5913 | 1.5820 | +0.239 % | -0.126 % |
| V017a Bishop simplified | 1.373 | 1.3821 | 1.3823 | +0.334 % | +0.677 % |
| V061 Morgenstern-Price (half-sine) | 2.343 | 2.3837 | 2.3483 | -0.013 % | +0.226 % |
| V061 Spencer | 2.383 | 2.4233 | 2.3879 | +0.012 % | +0.206 % |
| V065 Spencer | 0.964 | 0.9607 | 0.9591 | -0.342 % | -0.508 % |
| V017b Bishop simplified | 1.378 | 1.3821 | 1.3823 | +0.152 % | +0.312 % |
| V009c Spencer, non-circular | 1.868 | 1.8669 | 1.8666 | -0.059 % | -0.075 % |
| V017a Spencer | 1.386 | 1.3981 | 1.3983 | +0.873 % | +0.887 % |
| **Mean error (n = 266)** | | | | -0.204 % | -0.219 % |
| **Mean absolute error** | | | | 0.354 % | 0.358 % |
| **RMS error** | | | | 0.501 % | 0.509 % |
| **Largest error** | | | | 2.215 % | 2.215 % |

**Against the papers:** 4 moved (1 closer to the reference, 3 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V061 Morgenstern-Price (half-sine) (Wolff & Harr) | 2.360 | 2.3837 | 2.3483 | +1.004 % | -0.496 % |
| V065 Bishop simplified, circular (Leshchinsky & Han (2004)) | 1.000 | 0.9791 | 0.9775 | -2.090 % | -2.250 % |
| V005 infinite slope (Theory) | 2.500 | 2.5228 | 2.5237 | +0.912 % | +0.948 % |
| V009c Spencer, non-circular (Baker & Leshchinsky (2001)) | 1.910 | 1.8669 | 1.8666 | -2.257 % | -2.272 % |
| **Mean error (n = 97)** | | | | -0.222 % | -0.291 % |
| **Mean absolute error** | | | | 1.146 % | 1.092 % |
| **RMS error** | | | | 1.660 % | 1.581 % |
| **Largest error** | | | | 5.385 % | 5.385 % |


### 2026-10-24: Inputs corrected from the night investigation (V082a-c water table, V039/V040 clay 6.5 m, V051 phreatic correction, V087 R = 169.0 ft); Morgenstern-Price returns the interpolated crossing; default tolerance 0.001

Compared with 7260a6b. Errors are relative to the reference, in percent. Verification run time: 88 s (4 workers, load 0.9 at start).

**Against other programs (midpoint of their range):** 45 moved (29 closer to the reference, 16 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V051 Spencer, non-circular | 0.707 | 0.6952 | 0.7139 | -1.669 % | +0.976 % |
| V082a Spencer | 1.532 | 1.5032 | 1.5331 | -1.880 % | +0.072 % |
| V082a Bishop simplified | 1.532 | 1.5040 | 1.5338 | -1.828 % | +0.117 % |
| V082a Morgenstern-Price (half-sine) | 1.532 | 1.5032 | 1.5330 | -1.880 % | +0.065 % |
| V082b Spencer | 1.510 | 1.4825 | 1.5118 | -1.821 % | +0.119 % |
| V082b Bishop simplified | 1.511 | 1.4833 | 1.5126 | -1.833 % | +0.106 % |
| V040 Bishop simplified | 1.461 | 1.4326 | 1.4592 | -1.944 % | -0.123 % |
| V039 Spencer, non-circular | 1.167 | 1.1486 | 1.1618 | -1.577 % | -0.446 % |
| V082c Spencer | 1.402 | 1.3755 | 1.4022 | -0.936 % | +0.014 % |
| V082c Bishop simplified | 1.396 | 1.3692 | 1.3958 | -0.962 % | -0.014 % |
| V087 Janbu corrected | 2.290 | 2.2583 | 2.2477 | -1.384 % | -1.847 % |
| V078 Morgenstern-Price (half-sine) | 0.960 | 0.9566 | 0.9579 | -0.354 % | -0.219 % |
| V034a Spencer, non-circular | 1.262 | 1.2584 | 1.2601 | -0.285 % | -0.151 % |
| V002 Spencer, non-circular | 0.414 | 0.4113 | 0.4110 | -0.652 % | -0.725 % |
| V050b Spencer, non-circular | 1.246 | 1.2249 | 1.2254 | -1.693 % | -1.653 % |
| V014 Spencer | 1.576 | 1.5749 | 1.5755 | -0.070 % | -0.032 % |
| V053 Spencer, non-circular | 1.010 | 1.0058 | 1.0061 | -0.416 % | -0.386 % |
| V080 Morgenstern-Price (half-sine) | 1.049 | 1.0493 | 1.0490 | +0.029 % | 0.000 % |
| V032b Spencer | 1.155 | 1.1559 | 1.1556 | +0.078 % | +0.052 % |
| V079 Spencer | 1.049 | 1.0485 | 1.0483 | -0.048 % | -0.067 % |
| V050a Spencer | 1.277 | 1.2764 | 1.2762 | -0.047 % | -0.063 % |
| V006 Spencer | 1.351 | 1.3518 | 1.3520 | +0.059 % | +0.074 % |
| V036a Spencer, non-circular | 0.740 | 0.7359 | 0.7360 | -0.554 % | -0.541 % |
| V033 Spencer, non-circular | 1.534 | 1.5219 | 1.5221 | -0.789 % | -0.776 % |
| V041b Spencer, non-circular | 1.590 | 1.5894 | 1.5892 | -0.038 % | -0.050 % |
| V041a Spencer, non-circular | 1.592 | 1.5914 | 1.5912 | -0.038 % | -0.050 % |
| V042 Spencer | 1.648 | 1.6585 | 1.6587 | +0.637 % | +0.649 % |
| V036b Spencer, non-circular | 0.903 | 0.8829 | 0.8830 | -2.226 % | -2.215 % |
| V077 Spencer | 0.940 | 0.9427 | 0.9428 | +0.287 % | +0.298 % |
| V009a Spencer | 1.925 | 1.9262 | 1.9260 | +0.062 % | +0.052 % |
| V066b Spencer | 1.011 | 1.0106 | 1.0105 | -0.040 % | -0.049 % |
| V018 Spencer | 1.051 | 1.0521 | 1.0520 | +0.105 % | +0.095 % |
| V038 Spencer | 1.100 | 1.0768 | 1.0769 | -2.109 % | -2.100 % |
| V036d Spencer, non-circular | 1.116 | 1.1191 | 1.1192 | +0.278 % | +0.287 % |
| V034b Spencer, non-circular | 1.182 | 1.1681 | 1.1682 | -1.176 % | -1.168 % |
| V059a Spencer, non-circular | 1.215 | 1.2137 | 1.2136 | -0.107 % | -0.115 % |
| V091 Spencer | 1.241 | 1.2348 | 1.2349 | -0.500 % | -0.492 % |
| V091 Morgenstern-Price (half-sine) | 1.244 | 1.2348 | 1.2349 | -0.740 % | -0.732 % |
| V059b Spencer, non-circular | 1.290 | 1.2893 | 1.2892 | -0.054 % | -0.062 % |
| V071b Spencer | 1.300 | 1.2943 | 1.2944 | -0.438 % | -0.431 % |
| V059c Spencer, non-circular | 1.315 | 1.3119 | 1.3118 | -0.236 % | -0.243 % |
| V031b Spencer | 1.359 | 1.3520 | 1.3519 | -0.515 % | -0.522 % |
| V098 Spencer | 1.366 | 1.3721 | 1.3722 | +0.447 % | +0.454 % |
| V049 Spencer | 1.375 | 1.3721 | 1.3722 | -0.211 % | -0.204 % |
| V052b Morgenstern-Price (half-sine) | 2.299 | 2.2994 | 2.2993 | +0.017 % | +0.013 % |
| **Mean error (n = 269)** | | | | -0.269 % | -0.204 % |
| **Mean absolute error** | | | | 0.407 % | 0.354 % |
| **RMS error** | | | | 0.589 % | 0.501 % |
| **Largest error** | | | | 2.226 % | 2.215 % |

**Against the papers:** 9 moved (9 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V039 Bishop simplified (Duncan & Wright) | 1.450 | 1.4243 | 1.4507 | -1.772 % | +0.048 % |
| V039 Spencer, non-circular (Duncan & Wright) | 1.170 | 1.1486 | 1.1618 | -1.829 % | -0.701 % |
| V002 Spencer, non-circular (Kim et al. (2002)) | 0.390 | 0.4113 | 0.4110 | +5.462 % | +5.385 % |
| V002 Spencer, non-circular (Greco (1996)) | 0.390 | 0.4113 | 0.4110 | +5.462 % | +5.385 % |
| V053 Spencer, non-circular (Chen & Shao (1988)) | 1.010 | 1.0058 | 1.0061 | -0.416 % | -0.386 % |
| V032b Spencer (Duncan & Wright) | 1.150 | 1.1559 | 1.1556 | +0.513 % | +0.487 % |
| V080 Spencer (Priest) | 1.049 | 1.0492 | 1.0490 | +0.019 % | 0.000 % |
| V018 Spencer (Chen & Shao (1988)) | 1.050 | 1.0521 | 1.0520 | +0.200 % | +0.190 % |
| V031b Spencer (Duncan & Wright) | 1.350 | 1.3520 | 1.3519 | +0.148 % | +0.141 % |
| **Mean error (n = 97)** | | | | -0.251 % | -0.222 % |
| **Mean absolute error** | | | | 1.178 % | 1.146 % |
| **RMS error** | | | | 1.684 % | 1.660 % |
| **Largest error** | | | | 5.462 % | 5.385 % |


### 2026-10-24: Zhu & Lee's simplified Bishop value for surface 3 (V096a, V096c) marked disputed and left out of the statistics; confirmed in the paper

Compared with e2dccba. Errors are relative to the reference, in percent. Verification run time: 88 s (4 workers, load 0.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 268)** | | | | -0.269 % | -0.269 % |
| **Mean absolute error** | | | | 0.407 % | 0.407 % |
| **RMS error** | | | | 0.589 % | 0.589 % |
| **Largest error** | | | | 2.226 % | 2.226 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 97)** | | | | +0.274 % | -0.251 % |
| **Mean absolute error** | | | | 1.673 % | 1.178 % |
| **RMS error** | | | | 4.014 % | 1.684 % |
| **Largest error** | | | | 25.892 % | 5.462 % |


### 2026-10-24: Final review: slicing with dense water lines, weaker soil on a layer boundary, pile pond water

Compared with 6b587e5. Errors are relative to the reference, in percent. Verification run time: 91 s (4 workers, load 0.9 at start).

**Against other programs (midpoint of their range):** 2 moved (2 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V051 Spencer, non-circular | 0.707 | 0.6949 | 0.6952 | -1.711 % | -1.669 % |
| V094 Morgenstern-Price (half-sine), non-circular | 1.389 | 1.3881 | 1.3885 | -0.065 % | -0.036 % |
| **Mean error (n = 268)** | | | | -0.269 % | -0.269 % |
| **Mean absolute error** | | | | 0.408 % | 0.407 % |
| **RMS error** | | | | 0.590 % | 0.589 % |
| **Largest error** | | | | 2.226 % | 2.226 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 99)** | | | | +0.274 % | +0.274 % |
| **Mean absolute error** | | | | 1.673 % | 1.673 % |
| **RMS error** | | | | 4.014 % | 4.014 % |
| **Largest error** | | | | 25.892 % | 25.892 % |


### 2026-10-24: Engine default: 500 refined iterations, as the desktop app (review C2)

Compared with c260a33. Errors are relative to the reference, in percent. Verification run time: 91 s (4 workers, load 3.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 268)** | | | | -0.269 % | -0.269 % |
| **Mean absolute error** | | | | 0.408 % | 0.408 % |
| **RMS error** | | | | 0.590 % | 0.590 % |
| **Largest error** | | | | 2.226 % | 2.226 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 99)** | | | | +0.274 % | +0.274 % |
| **Mean absolute error** | | | | 1.673 % | 1.673 % |
| **RMS error** | | | | 4.014 % | 4.014 % |
| **Largest error** | | | | 25.892 % | 25.892 % |


### 2026-10-24: Non-circular optimisation: the best surface is optimised further while it still improves (review C2)

Compared with a58b369. Errors are relative to the reference, in percent. Verification run time: 90 s (4 workers, load 2.1 at start).

**Against other programs (midpoint of their range):** 20 moved (5 closer to the reference, 15 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V034a Spencer, non-circular | 1.262 | 1.2688 | 1.2584 | +0.539 % | -0.285 % |
| V039 Spencer, non-circular | 1.167 | 1.1549 | 1.1486 | -1.037 % | -1.577 % |
| V034b Spencer, non-circular | 1.182 | 1.1732 | 1.1681 | -0.745 % | -1.176 % |
| V051 Spencer, non-circular | 0.707 | 0.6976 | 0.6949 | -1.330 % | -1.711 % |
| V053 Spencer, non-circular | 1.010 | 1.0089 | 1.0058 | -0.109 % | -0.416 % |
| V026 Spencer, non-circular | 1.190 | 1.1735 | 1.1702 | -1.387 % | -1.664 % |
| V050b Spencer, non-circular | 1.246 | 1.2282 | 1.2249 | -1.429 % | -1.693 % |
| V059b Spencer, non-circular | 1.290 | 1.2923 | 1.2893 | +0.178 % | -0.054 % |
| V036a Spencer, non-circular | 0.740 | 0.7375 | 0.7359 | -0.338 % | -0.554 % |
| V059a Spencer, non-circular | 1.215 | 1.2162 | 1.2137 | +0.099 % | -0.107 % |
| V094 Morgenstern-Price (half-sine), non-circular | 1.389 | 1.3907 | 1.3881 | +0.122 % | -0.065 % |
| V059c Spencer, non-circular | 1.315 | 1.3142 | 1.3119 | -0.061 % | -0.236 % |
| V036b Spencer, non-circular | 0.903 | 0.8844 | 0.8829 | -2.060 % | -2.226 % |
| V002 Spencer, non-circular | 0.414 | 0.4119 | 0.4113 | -0.507 % | -0.652 % |
| V094 Spencer, non-circular | 1.398 | 1.4019 | 1.4000 | +0.279 % | +0.143 % |
| V093 Spencer, non-circular | 1.325 | 1.3242 | 1.3224 | -0.060 % | -0.196 % |
| V036d Spencer, non-circular | 1.116 | 1.1206 | 1.1191 | +0.412 % | +0.278 % |
| V001 Spencer, non-circular | 1.386 | 1.3855 | 1.3837 | -0.036 % | -0.166 % |
| V033 Spencer, non-circular | 1.534 | 1.5238 | 1.5219 | -0.665 % | -0.789 % |
| V009c Spencer, non-circular | 1.868 | 1.8683 | 1.8669 | +0.016 % | -0.059 % |
| **Mean error (n = 268)** | | | | -0.250 % | -0.269 % |
| **Mean absolute error** | | | | 0.398 % | 0.408 % |
| **RMS error** | | | | 0.570 % | 0.590 % |
| **Largest error** | | | | 2.109 % | 2.226 % |

**Against the papers:** 15 moved (3 closer to the reference, 12 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V002 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 0.430 | 0.4157 | 0.4131 | -3.326 % | -3.930 % |
| V039 Spencer, non-circular (Duncan & Wright) | 1.170 | 1.1549 | 1.1486 | -1.291 % | -1.829 % |
| V053 Spencer, non-circular (Chen & Shao (1988)) | 1.010 | 1.0089 | 1.0058 | -0.109 % | -0.416 % |
| V002 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.405 | 0.3933 | 0.3926 | -2.889 % | -3.062 % |
| V002 Spencer, non-circular (Kim et al. (2002)) | 0.390 | 0.4119 | 0.4113 | +5.615 % | +5.462 % |
| V002 Spencer, non-circular (Greco (1996)) | 0.390 | 0.4119 | 0.4113 | +5.615 % | +5.462 % |
| V094 Spencer, non-circular (Greco (1996)) | 1.400 | 1.4019 | 1.4000 | +0.136 % | 0.000 % |
| V093 Spencer, non-circular (Greco (1996)) | 1.330 | 1.3242 | 1.3224 | -0.436 % | -0.571 % |
| V093 Spencer, non-circular (Yamagami & Ueta (1988)) | 1.339 | 1.3242 | 1.3224 | -1.105 % | -1.240 % |
| V001 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 1.265 | 1.2529 | 1.2516 | -0.957 % | -1.059 % |
| V003 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 1.071 | 1.0481 | 1.0470 | -2.138 % | -2.241 % |
| V093 Janbu simplified, non-circular (Yamagami & Ueta (1988)) | 1.185 | 1.1776 | 1.1764 | -0.624 % | -0.726 % |
| V003 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.995 | 0.9671 | 0.9661 | -2.804 % | -2.905 % |
| V001 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 1.357 | 1.3460 | 1.3447 | -0.811 % | -0.906 % |
| V009c Spencer, non-circular (Baker & Leshchinsky (2001)) | 1.910 | 1.8683 | 1.8669 | -2.183 % | -2.257 % |
| **Mean error (n = 99)** | | | | +0.303 % | +0.274 % |
| **Mean absolute error** | | | | 1.653 % | 1.673 % |
| **RMS error** | | | | 4.007 % | 4.014 % |
| **Largest error** | | | | 25.892 % | 25.892 % |


### 2026-10-24: Surfaces leaving the model through its base are rejected (review C2)

Compared with 105d40d. Errors are relative to the reference, in percent. Verification run time: not recorded.

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 268)** | | | | -0.250 % | -0.250 % |
| **Mean absolute error** | | | | 0.398 % | 0.398 % |
| **RMS error** | | | | 0.570 % | 0.570 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 99)** | | | | +0.303 % | +0.303 % |
| **Mean absolute error** | | | | 1.653 % | 1.653 % |
| **RMS error** | | | | 4.007 % | 4.007 % |
| **Largest error** | | | | 25.892 % | 25.892 % |


### 2026-10-24: Search: entry points behind loads on top of the grid (review C2)

Compared with 0463541. Errors are relative to the reference, in percent. Verification run time: not recorded.

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 268)** | | | | -0.250 % | -0.250 % |
| **Mean absolute error** | | | | 0.398 % | 0.398 % |
| **RMS error** | | | | 0.570 % | 0.570 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 99)** | | | | +0.303 % | +0.303 % |
| **Mean absolute error** | | | | 1.653 % | 1.653 % |
| **RMS error** | | | | 4.007 % | 4.007 % |
| **Largest error** | | | | 25.892 % | 25.892 % |


### 2026-10-24: Slices: water-line corners as slice edges, no head correction at a vertical step; a base on a layer boundary takes the layer below (review B4, C3)

Compared with 433b9b3. Errors are relative to the reference, in percent. Verification run time: 87 s (4 workers).

**Against other programs (midpoint of their range):** 24 moved (19 closer to the reference, 5 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V094 Morgenstern-Price (half-sine), non-circular | 1.389 | 1.3910 | 1.3907 | +0.144 % | +0.122 % |
| V051 Spencer, non-circular | 0.707 | 0.6975 | 0.6976 | -1.344 % | -1.330 % |
| V003 Spencer | 1.118 | 1.1134 | 1.1135 | -0.411 % | -0.403 % |
| V025 Bishop simplified | 1.142 | 1.1323 | 1.1324 | -0.849 % | -0.841 % |
| V096b Bishop simplified | 1.176 | 1.1730 | 1.1731 | -0.255 % | -0.247 % |
| V017a Bishop simplified | 1.377 | 1.3822 | 1.3821 | +0.341 % | +0.334 % |
| V017b Bishop simplified | 1.380 | 1.3822 | 1.3821 | +0.159 % | +0.152 % |
| V082c Bishop simplified | 1.382 | 1.3691 | 1.3692 | -0.969 % | -0.962 % |
| V017a Spencer | 1.386 | 1.3982 | 1.3981 | +0.880 % | +0.873 % |
| V021g Morgenstern-Price (half-sine) | 1.422 | 1.4280 | 1.4281 | +0.422 % | +0.429 % |
| V082b Spencer | 1.510 | 1.4824 | 1.4825 | -1.828 % | -1.821 % |
| V082b Bishop simplified | 1.511 | 1.4832 | 1.4833 | -1.840 % | -1.833 % |
| V082a Bishop simplified | 1.532 | 1.5039 | 1.5040 | -1.834 % | -1.828 % |
| V033 Bishop simplified | 1.533 | 1.5208 | 1.5209 | -0.796 % | -0.789 % |
| V033 Spencer, non-circular | 1.534 | 1.5239 | 1.5238 | -0.658 % | -0.665 % |
| V024 Spencer | 1.557 | 1.5623 | 1.5622 | +0.340 % | +0.334 % |
| V024 Bishop simplified | 1.567 | 1.5719 | 1.5718 | +0.281 % | +0.274 % |
| V042 Bishop simplified | 1.587 | 1.5912 | 1.5913 | +0.233 % | +0.239 % |
| V042 Morgenstern-Price (half-sine) | 1.670 | 1.6699 | 1.6700 | -0.006 % | 0.000 % |
| V092 Janbu corrected | 1.830 | 1.8324 | 1.8325 | +0.131 % | +0.137 % |
| V092 Bishop simplified | 2.011 | 1.9980 | 1.9981 | -0.646 % | -0.641 % |
| V092 Spencer | 2.026 | 2.0121 | 2.0122 | -0.686 % | -0.681 % |
| V021f Bishop simplified | 2.128 | 2.1281 | 2.1280 | +0.005 % | 0.000 % |
| V021f Morgenstern-Price (half-sine) | 2.138 | 2.1281 | 2.1280 | -0.463 % | -0.468 % |
| **Mean error (n = 268)** | | | | -0.250 % | -0.250 % |
| **Mean absolute error** | | | | 0.398 % | 0.398 % |
| **RMS error** | | | | 0.570 % | 0.570 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 3 moved (2 closer to the reference, 1 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V033 Spencer (Duncan & Wright) | 1.535 | 1.5327 | 1.5328 | -0.150 % | -0.143 % |
| V024 Bishop simplified (Duncan & Wright) | 1.570 | 1.5719 | 1.5718 | +0.121 % | +0.115 % |
| V021f Bishop simplified (Chowdhury & Xu) | 2.140 | 2.1281 | 2.1280 | -0.537 % | -0.542 % |
| **Mean error (n = 99)** | | | | +0.303 % | +0.303 % |
| **Mean absolute error** | | | | 1.653 % | 1.653 % |
| **RMS error** | | | | 4.007 % | 4.007 % |
| **Largest error** | | | | 25.892 % | 25.892 % |


### 2026-10-24: Lime-cement columns: each strength part takes its own partial factor; pile force takes the weaker branch (review B3, B9)

Compared with d556b3c. Errors are relative to the reference, in percent. Verification run time: 216 s (4 workers).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 268)** | | | | -0.250 % | -0.250 % |
| **Mean absolute error** | | | | 0.398 % | 0.398 % |
| **RMS error** | | | | 0.570 % | 0.570 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 99)** | | | | +0.303 % | +0.303 % |
| **Mean absolute error** | | | | 1.653 % | 1.653 % |
| **RMS error** | | | | 4.007 % | 4.007 % |
| **Largest error** | | | | 25.892 % | 25.892 % |


### 2026-10-24: Warning for Bishop on non-circular surfaces (review B1)

Compared with 80138ca. Errors are relative to the reference, in percent. Verification run time: 168 s (4 workers).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 268)** | | | | -0.250 % | -0.250 % |
| **Mean absolute error** | | | | 0.398 % | 0.398 % |
| **RMS error** | | | | 0.570 % | 0.570 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 99)** | | | | +0.303 % | +0.303 % |
| **Mean absolute error** | | | | 1.653 % | 1.653 % |
| **RMS error** | | | | 4.007 % | 4.007 % |
| **Largest error** | | | | 25.892 % | 25.892 % |


### 2026-10-24: Circular search: circles tangent to material interfaces, seeds per basin (review A3)

Compared with f9cdd21. Errors are relative to the reference, in percent. Verification run time: not recorded.

**Against other programs (midpoint of their range):** 7 moved (3 closer to the reference, 4 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V094 Morgenstern-Price (half-sine), non-circular | 1.389 | 1.3946 | 1.3910 | +0.403 % | +0.144 % |
| V094 Spencer, non-circular | 1.398 | 1.4011 | 1.4019 | +0.222 % | +0.279 % |
| V008a Spencer | 1.536 | 1.5192 | 1.5187 | -1.094 % | -1.126 % |
| V059c Spencer, non-circular | 1.315 | 1.3139 | 1.3142 | -0.084 % | -0.061 % |
| V009c Spencer, non-circular | 1.868 | 1.8680 | 1.8683 | 0.000 % | +0.016 % |
| V057b Spencer | 2.022 | 2.0231 | 2.0229 | +0.054 % | +0.045 % |
| V004b Janbu simplified | 2.610 | 2.6091 | 2.6090 | -0.034 % | -0.038 % |
| **Mean error (n = 268)** | | | | -0.250 % | -0.250 % |
| **Mean absolute error** | | | | 0.399 % | 0.398 % |
| **RMS error** | | | | 0.570 % | 0.570 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 5 moved (3 closer to the reference, 2 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V002 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 0.430 | 0.4126 | 0.4157 | -4.047 % | -3.326 % |
| V002 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.405 | 0.3927 | 0.3933 | -3.037 % | -2.889 % |
| V094 Spencer, non-circular (Greco (1996)) | 1.400 | 1.4011 | 1.4019 | +0.079 % | +0.136 % |
| V009c Spencer, non-circular (Baker & Leshchinsky (2001)) | 1.910 | 1.8680 | 1.8683 | -2.199 % | -2.183 % |
| V057b limit-equilibrium chart (Griffiths & Lane) | 2.040 | 2.0231 | 2.0229 | -0.828 % | -0.838 % |
| **Mean error (n = 99)** | | | | +0.294 % | +0.303 % |
| **Mean absolute error** | | | | 1.661 % | 1.653 % |
| **RMS error** | | | | 4.014 % | 4.007 % |
| **Largest error** | | | | 25.892 % | 25.892 % |

