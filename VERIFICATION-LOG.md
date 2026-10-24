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
<!-- summary-end -->

## Entries

<!-- entries -->

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

