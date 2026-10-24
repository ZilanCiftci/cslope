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
<!-- summary-end -->

## Entries

<!-- entries -->

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

