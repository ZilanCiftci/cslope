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
| 2026-10-25 | Round two from the source extracts: V063 check is Bishop, Greco's global minimum 0.97 on V053, tiered-wall reinforcement 6.3 m, Morgenstern and Low reference values, Prandtl 1920 | 2 | 0.353 → 0.353 | 0.499 → 0.499 | 0.955 → 1.008 | 1.464 → 1.543 | 107 s (4 workers, load 1.5 at start) |
| 2026-10-25 | Round three from 18 new sources: C&X, Cheng, D&W Table 14.1 and 2nd-edition values; new V010b, V038b, V086d-e on the sources' own input; V036 reference values printed, not read | 2 | 0.353 → 0.348 | 0.499 → 0.483 | 1.008 → 1.011 | 1.543 → 1.595 | 103 s (4 workers, load 0.8 at start) |
| 2026-10-27 | Strength reduction by finite elements: FE column for 19 problems | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 2418 s (4 workers, load 0.9 at start) |
| 2026-10-28 | FE step 3: reinforcement bars, seepage, robust strength reduction search; Leshchinsky & Han walls not compared | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 3193 s (4 workers, load 1.4 at start) |
| 2026-10-28 | Fixes from the finite element review (lower bound γsat and seepage pore pressures, seepage face, rigid materials, FE cache key) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 1276 s (4 workers, load 0.8 at start) |
| 2026-10-28 | Faster finite element strength reduction (sparse Cholesky, collapse estimate, guided refinement) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 1573 s (4 workers, load 1.2 at start) |
| 2026-10-28 | FE solver review: published methods only (bisection without collapse estimate, Aitken relaxation in seepage) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 1196 s (4 workers, load 1.3 at start) |
| 2026-10-28 | Newton decides associated FE trials alone (viscoplastic referee removed); BFGS solver as an option | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 1236 s (4 workers, load 0.7 at start) |
| 2026-10-28 | FE review fixes: Newton line search and stall test, confirmed failure bounds, local thin-layer size, engine-independent mesh, design strength and Tresca cap in FE, seepage side heads, certified lower bound | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 757 s (4 workers, load 2.9 at start) |
| 2026-10-28 | Viscoplastic iteration: stresses beyond the Mohr-Coulomb apex relaxed towards it (V094-type cohesionless layer at the toe) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 305 s (4 workers, load 0.6 at start) |
| 2026-10-29 | FE references from a commercial FE program's verification manual on 15 problems; new problem V099 (ACADS 5, FE seepage) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 1105 s (4 workers, load 0.9 at start) |
| 2026-10-29 | FE solver speed-up: allocation-free stress return, scatter assembly, nested dissection with minimum-cover separators | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 966 s (4 workers, load 3.8 at start) |
| 2026-10-29 | Non-associated Newton (unsymmetric tangent, LU) and equilibrium convergence test as options; F–displacement curve | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 966 s (4 workers, load 4.8 at start) |
| 2026-10-29 | Upper bound limit analysis (Sloan & Kleeman 1995) and both bounds as an app option | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 1088 s (4 workers, load 1.0 at start) |
| 2026-10-29 | Initial stresses (K0 procedure) and staged construction in FE, as options | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 1160 s (4 workers, load 5.3 at start) |
| 2026-10-29 | FE: embedded pile rows, anchors with free length and lock-off load | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 1093 s (4 workers, load 5.3 at start) |
| 2026-10-29 | Generalised Hoek-Brown rock in limit equilibrium and FE | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 933 s (4 workers, load 5.2 at start) |
| 2026-10-29 | Newton: a return to the Mohr–Coulomb apex gets 10⁻³ of the elastic tangent instead of zero | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 893 s (4 workers, load 4.2 at start) |
| 2026-10-29 | Limit analysis in the app refined on the gap between the lower and upper bound | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 670 s (4 workers, load 3.5 at start) |
| 2026-10-29 | Anderson-accelerated viscoplastic iteration with the equilibrium test, as an option | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 476 s (4 workers, load 2.5 at start) |
| 2026-10-29 | Faster bound gap refinement: coarse tolerance on the steering levels, lower bound started at the last bound, smallest element size limited | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 440 s (4 workers, load 2.0 at start) |
| 2026-10-30 | Infinite-slope warning for faces in cohesionless soil | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 485 s (4 workers, load 1.8 at start) |
| 2026-10-30 | Limit analysis bounds on second-order cones solved by Clarabel (WebAssembly) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 513 s (4 workers, load 1.0 at start) |
| 2026-10-30 | Lower bound: four elements at each corner of the ground surface, bracketed F searches, seepage heads at added nodes | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 544 s (4 workers, load 1.0 at start) |
| 2026-10-30 | Refined meshes start from the coarser mesh's state (associated flow) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 594 s (4 workers, load 2.3 at start) |
| 2026-10-30 | FE factor of safety from the limit analysis bounds; Davis B bounds; no adaptive strength reduction for non-associated flow in the app | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 666 s (4 workers, load 0.7 at start) |
| 2026-11-01 | Lower bound: fans of elements at the ends of loads and at corners | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 416 s (4 workers, load 3.1 at start) |
| 2026-11-01 | Anisotropy on the undrained strengths (undrained, from depth, from datum) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 416 s (4 workers, load 4.4 at start) |
| 2026-11-01 | Partial factors in Swedish practice from the safety class and eta | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 416 s (4 workers, load 1.4 at start) |
| 2026-11-01 | Model-space helpers for analysed surfaces (toModelX, toModelCircle) | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 409 s (4 workers, load 3.9 at start) |
| 2026-11-01 | 3D effects of temporary slopes after SGI Vägledning 8 | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 414 s (4 workers, load 3.3 at start) |
| 2026-11-01 | Warning for shallow critical surfaces in cohesionless soil; minimum entry-exit distance in the options | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 424 s (4 workers, load 2.5 at start) |
| 2026-11-02 | Combined S = f(depth) (drained c′ + σ′ tan φ′ limited by Su, c′ with depth); SGI 3D end faces take Su of combined clay | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 849 s (4 workers, load 4.3 at start) |
| 2026-11-02 | Strength from suction (φb) above the water line | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 770 s (4 workers, load 5.0 at start) |
| 2026-11-02 | Distributed loads normal to the ground | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 779 s (4 workers, load 4.2 at start) |
| 2026-11-02 | Tension crack at a limiting base inclination | 0 | 0.348 → 0.348 | 0.483 → 0.483 | 1.011 → 1.011 | 1.595 → 1.595 | 757 s (4 workers, load 4.9 at start) |
| 2026-11-02 | Arc-consistent slice base on circles, steep ends cut | 177 | 0.348 → 0.342 | 0.483 → 0.477 | 1.011 → 1.009 | 1.595 → 1.595 | 753 s (4 workers, load 1.7 at start) |
| 2026-11-02 | Search ranges given as a point; .gsz tension crack angle and water | 0 | 0.342 → 0.342 | 0.477 → 0.477 | 1.009 → 1.009 | 1.595 → 1.595 | 730 s (4 workers, load 1.3 at start) |
| 2026-11-02 | Exit range starting at the toe moved upslope; Hoek-Brown mb, s, a given directly | 1 | 0.342 → 0.342 | 0.477 → 0.477 | 1.009 → 1.009 | 1.595 → 1.596 | 779 s (4 workers, load 1.2 at start) |
| 2026-11-03 | Composite circles along bedrock (default on); along the model base optional (compositeBase) | 2 | 0.342 → 0.342 | 0.477 → 0.476 | 1.009 → 1.003 | 1.596 → 1.589 | 719 s (4 workers, load 3.7 at start) |
| 2026-11-03 | Reinforcement, SHANSEP, B-bar, shear-normal, seismic, inclined line loads, rapid drawdown; composite review fixes | 0 | 0.342 → 0.342 | 0.476 → 0.476 | 1.003 → 1.003 | 1.589 → 1.589 | 210 s (4 workers, load 0.7 at start) |
| 2026-11-03 | Import and export of .stix and .sli/.slim/.slmd files; waternet, strength above the water line, POP/yield stress with an earlier stage, load consolidation | 0 | 0.342 → 0.342 | 0.476 → 0.476 | 1.003 → 1.003 | 1.589 → 1.589 | 498 s (4 workers, load 2.8 at start) |
| 2026-11-03 | Pore pressure ratio ru | 0 | 0.342 → 0.342 | 0.476 → 0.476 | 1.003 → 1.003 | 1.589 → 1.589 | 489 s (4 workers, load 5.4 at start) |
| 2026-11-03 | Verification problems with the pore pressure ratio ru (Fredlund & Krahn cases 3 and 4, Li & Lumb, Loukidis et al., Spencer, Jiang et al.) | 0 | 0.342 → 0.336 | 0.476 → 0.469 | 1.003 → 0.942 | 1.589 → 1.522 | 110 s (4 workers, load 0.8 at start) |
| 2026-11-03 | Verification problems for B̄, SHANSEP with an earlier stage and head lines (V104, V105) | 0 | 0.336 → 0.332 | 0.469 → 0.465 | 0.942 → 0.942 | 1.522 → 1.522 | 537 s (4 workers, load 4.3 at start) |
| 2026-11-03 | Parallel evaluation of trial surfaces (searches as steps, evaluator pool); sequential path unchanged | 0 | 0.332 → 0.332 | 0.465 → 0.465 | 0.942 → 0.942 | 1.522 → 1.522 | 803 s (4 workers, load 1.3 at start) |
| 2026-11-04 | Morgenstern-Price: a converged solution needs positive Fm and Ff and a gap below a capped tolerance | 0 | 0.332 → 0.332 | 0.465 → 0.465 | 0.942 → 0.942 | 1.522 → 1.522 | 2341 s (4 workers, load 13.9 at start) |
| 2026-11-04 | Engine rewritten in Rust (WebAssembly); TypeScript engine removed | 0 | 0.332 → 0.332 | 0.465 → 0.465 | 0.942 → 0.942 | 1.522 → 1.522 | 575 s (4 workers, load 2.2 at start) |
| 2026-11-04 | V056: Griffiths & Lane's coarse-mesh finite element value disputed, not counted; slice shear force reported by the engine | 0 | 0.332 → 0.332 | 0.465 → 0.465 | 0.942 → 0.942 | 1.522 → 1.522 | 554 s (4 workers, load 0.9 at start) |
| 2026-11-04 | Minimum slip area defaults to 0 (no limit); slice shear force and FE progress from the engine | 8 | 0.332 → 0.323 | 0.465 → 0.455 | 0.942 → 0.938 | 1.522 → 1.521 | 503 s (4 workers, load 1.0 at start) |
| 2026-11-05 | Verification texts in American spelling (no engine change) | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 543 s (4 workers, load 0.6 at start) |
| 2026-11-05 | A nearly vertical model side is not ground: no slip surface through it | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 194 s (4 workers, load 2.4 at start) |
| 2026-11-06 | Engine TS cleanup (#51): no result should move | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 546 s (4 workers, load 3.0 at start) |
| 2026-11-06 | Schema, validation and result summary (#55) | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 501 s (4 workers, load 1.2 at start) |
| 2026-11-06 | cslope-project conversion (#57) and Monte Carlo message (#81) | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 484 s (4 workers, load 2.0 at start) |
| 2026-11-07 | Engine: boundary ends past, on or just inside the outline split the regions (#93) | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 517 s (4 workers, load 1.0 at start) |
| 2026-11-07 | Engine: shallow-slide warning says design φ′ only on design values (#106) | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 520 s (4 workers, load 1.2 at start) |
| 2026-11-07 | Engine: the same bits on every platform (libm crate); Python 3.10 minimum | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 529 s (4 workers, load 0.6 at start) |
| 2026-11-07 | Engine: warning when the critical surface lies on the edge of the search limits | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 533 s (4 workers, load 1.3 at start) |
| 2026-11-07 | Web: Download .cslp (project writer in a separate WebAssembly module) | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 542 s (4 workers, load 0.8 at start) |
| 2026-11-10 | Rust engine: faster slice builder and solvers (precomputed slice invariants, shared iteration), dead code and duplicates removed, workspace lints | 0 | 0.323 → 0.323 | 0.455 → 0.455 | 0.938 → 0.938 | 1.521 → 1.521 | 496 s (4 workers, load 1.4 at start) |
| 2026-11-11 | Slice base of a circle: the straight chord, with the base shear's moment arm to the chord, R·cos(Δθ/2) (Fredlund & Krahn 1977); the steep ends still cut; arc-consistent base removed | 285 | 0.323 → 0.317 | 0.455 → 0.449 | 0.938 → 0.936 | 1.521 → 1.520 | 534 s (4 workers, load 4.7 at start) |
| 2026-11-11 | Unit weight of water 9.807 kN/m³ (ρw·g with standard gravity), was 9.81 | 112 | 0.317 → 0.316 | 0.449 → 0.447 | 0.936 → 0.936 | 1.520 → 1.519 | 550 s (4 workers, load 4.4 at start) |
| 2026-11-11 | Unit weight of water as a model setting (default 9.807, nothing moves) | 0 | 0.316 → 0.316 | 0.447 → 0.447 | 0.936 → 0.936 | 1.519 → 1.519 | 573 s (4 workers, load 1.1 at start) |
| 2026-11-11 | Rapid drawdown: Kc = 1 envelope from the R envelope per Duncan, Wright & Brandon (2014) Eqs. 9.6–9.7; .gsz import reads the phreatic correction | 0 | 0.316 → 0.316 | 0.447 → 0.447 | 0.936 → 0.936 | 1.519 → 1.519 | 560 s (4 workers, load 3.8 at start) |
| 2026-11-11 | Slices of a circle without the steep-end cuts (V068 tolerance +1 % for a slicing-sensitive surface) | 166 | 0.316 → 0.308 | 0.447 → 0.441 | 0.936 → 0.948 | 1.519 → 1.531 | 638 s (4 workers, load 1.1 at start) |
| 2026-11-11 | Reinforcement: active (prestressed) elements always carry their force; the tension-only rule is for passive elements | 0 | 0.308 → 0.308 | 0.441 → 0.441 | 0.948 → 0.948 | 1.531 → 1.531 | 1308 s (4 workers, load 2.3 at start) |
| 2026-11-11 | Search: a single exit x on a vertical ground face exits at the foot of the face | 0 | 0.308 → 0.308 | 0.441 → 0.441 | 0.948 → 0.948 | 1.531 → 1.531 | 600 s (4 workers, load 2.3 at start) |
| 2026-11-12 | Search: a side given as a point gets one point in the first pass; a point on a corner is the two ends of its widened limit (issue #157) | 0 | 0.308 → 0.308 | 0.441 → 0.441 | 0.948 → 0.948 | 1.531 → 1.531 | 548 s (4 workers, load 3.3 at start) |
| 2026-11-12 | Local search: the unmoved end of a seed on a search limit is kept (limit tolerance 1e-9, as for the surfaces) | 0 | 0.308 → 0.308 | 0.441 → 0.441 | 0.948 → 0.948 | 1.531 → 1.531 | 567 s (4 workers, load 2.5 at start) |
| 2026-11-12 | Search: a pair given right to left gets its circle tangent to a material interface | 6 | 0.308 → 0.308 | 0.441 → 0.441 | 0.948 → 0.951 | 1.531 → 1.536 | 523 s (4 workers, load 3.7 at start) |
| 2026-11-12 | Search: first pass with 11 sagittas from 5 % to 95 % of the reference depth on 9 × 11 entry-exit pairs (issue #160) | 68 | 0.308 → 0.311 | 0.441 → 0.443 | 0.951 → 0.949 | 1.536 → 1.537 | 510 s (4 workers, load 1.0 at start) |
| 2026-11-12 | Search: entry and exit points evenly along the ground in the first pass, the refinement and the local search; an exit range end on a descending face is its foot (issue #158) | 56 | 0.311 → 0.315 | 0.443 → 0.454 | 0.949 → 0.948 | 1.537 → 1.533 | 518 s (4 workers, load 1.0 at start) |
<!-- summary-end -->

## Entries

<!-- entries -->

### 2026-11-12: Search: entry and exit points evenly along the ground in the first pass, the refinement and the local search; an exit range end on a descending face is its foot (issue #158)

Compared with 2a0e3666. Errors are relative to the reference, in percent. Verification run time: 518 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 36 moved (16 closer to the reference, 20 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V059b Spencer, non-circular | 1.290 | 1.2892 | 1.3118 | -0.062 % | +1.690 % |
| V034a Spencer, non-circular | 1.262 | 1.2579 | 1.2609 | -0.325 % | -0.087 % |
| V094 Morgenstern-Price (half-sine), non-circular | 1.389 | 1.3857 | 1.3881 | -0.238 % | -0.065 % |
| V003 Bishop simplified | 1.115 | 1.1155 | 1.1140 | +0.045 % | -0.090 % |
| V028 Bishop simplified | 1.126 | 1.1233 | 1.1246 | -0.240 % | -0.124 % |
| V104a Bishop simplified | 2.300 | 2.2918 | 2.2940 | -0.357 % | -0.261 % |
| V041b Spencer, non-circular | 1.590 | 1.5895 | 1.5880 | -0.031 % | -0.126 % |
| V086c Spencer | 1.209 | 1.2014 | 1.2005 | -0.629 % | -0.703 % |
| V036a Spencer, non-circular | 0.740 | 0.7373 | 0.7368 | -0.365 % | -0.432 % |
| V004a Spencer | 2.794 | 2.8033 | 2.8023 | +0.333 % | +0.297 % |
| V086c Morgenstern-Price (half-sine) | 1.218 | 1.2113 | 1.2109 | -0.550 % | -0.583 % |
| V033 Spencer, non-circular | 1.534 | 1.5224 | 1.5220 | -0.756 % | -0.782 % |
| V052a Janbu corrected | 1.949 | 1.9496 | 1.9501 | +0.031 % | +0.056 % |
| V098 Spencer, non-circular | 1.360 | 1.3567 | 1.3570 | -0.243 % | -0.221 % |
| V009c Spencer, non-circular | 1.868 | 1.8667 | 1.8670 | -0.070 % | -0.054 % |
| V100 Janbu simplified, non-circular | 1.563 | 1.5588 | 1.5586 | -0.269 % | -0.282 % |
| V100 Bishop simplified, non-circular | 1.656 | 1.6511 | 1.6513 | -0.296 % | -0.284 % |
| V004a Janbu simplified | 2.662 | 2.6764 | 2.6767 | +0.541 % | +0.552 % |
| V036d Spencer, non-circular | 1.116 | 1.1192 | 1.1193 | +0.287 % | +0.296 % |
| V039 Spencer, non-circular | 1.167 | 1.1604 | 1.1603 | -0.566 % | -0.574 % |
| V026 Spencer, non-circular | 1.190 | 1.1704 | 1.1703 | -1.647 % | -1.655 % |
| V059a Spencer, non-circular | 1.215 | 1.2136 | 1.2137 | -0.115 % | -0.107 % |
| V059c Spencer, non-circular | 1.315 | 1.3119 | 1.3118 | -0.236 % | -0.243 % |
| V093 Spencer, non-circular | 1.325 | 1.3226 | 1.3225 | -0.181 % | -0.189 % |
| V082d Janbu corrected | 1.345 | 1.3435 | 1.3436 | -0.112 % | -0.104 % |
| V082d Morgenstern-Price (half-sine) | 1.378 | 1.3715 | 1.3714 | -0.472 % | -0.479 % |
| V082d Spencer | 1.382 | 1.3763 | 1.3762 | -0.412 % | -0.420 % |
| V001 Spencer, non-circular | 1.386 | 1.3836 | 1.3837 | -0.173 % | -0.166 % |
| V073 Bishop simplified, circles only | 1.417 | 1.4109 | 1.4108 | -0.430 % | -0.438 % |
| V057a Spencer | 1.468 | 1.4735 | 1.4736 | +0.375 % | +0.381 % |
| V041a Spencer | 1.599 | 1.5955 | 1.5956 | -0.219 % | -0.213 % |
| V041b Spencer | 1.599 | 1.5950 | 1.5951 | -0.250 % | -0.244 % |
| V041b Bishop simplified | 1.603 | 1.5982 | 1.5983 | -0.299 % | -0.293 % |
| V041a Bishop simplified | 1.603 | 1.5983 | 1.5984 | -0.293 % | -0.287 % |
| V085 Janbu simplified | 1.628 | 1.6268 | 1.6267 | -0.074 % | -0.080 % |
| V052a Bishop simplified | 1.950 | 1.9477 | 1.9478 | -0.092 % | -0.087 % |
| **Mean error (n = 301)** | | | | -0.206 % | -0.199 % |
| **Mean absolute error** | | | | 0.311 % | 0.315 % |
| **RMS error** | | | | 0.443 % | 0.454 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 20 moved (11 closer to the reference, 9 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V002 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 0.430 | 0.4118 | 0.4130 | -4.233 % | -3.953 % |
| V003 Bishop simplified (Arai & Tagyo (1985)) | 1.138 | 1.1155 | 1.1140 | -1.977 % | -2.109 % |
| V086c Spencer (Tandjiria, Low & Teh (2002)) | 1.219 | 1.2014 | 1.2005 | -1.444 % | -1.518 % |
| V002 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.405 | 0.3920 | 0.3919 | -3.210 % | -3.235 % |
| V038b Spencer (Duncan & Wright) | 1.160 | 1.1578 | 1.1580 | -0.190 % | -0.172 % |
| V038b Spencer, finite-element pore pressures (Duncan, Wright & Brandon (2014)) | 1.190 | 1.1578 | 1.1580 | -2.706 % | -2.689 % |
| V009c Spencer, non-circular (Baker & Leshchinsky (2001)) | 1.910 | 1.8667 | 1.8670 | -2.267 % | -2.251 % |
| V100 Janbu simplified (uncorrected), non-circular (Jiang, Baker & Yamagami) | 1.560 | 1.5588 | 1.5586 | -0.077 % | -0.090 % |
| V003 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.995 | 0.9661 | 0.9660 | -2.905 % | -2.915 % |
| V028 Spencer (Duncan & Wright) | 1.124 | 1.1244 | 1.1243 | +0.036 % | +0.027 % |
| V039 Spencer, non-circular (Duncan & Wright) | 1.160 | 1.1604 | 1.1603 | +0.034 % | +0.026 % |
| V069a stability chart (Morgenstern) | 1.200 | 1.2009 | 1.2008 | +0.075 % | +0.067 % |
| V005 Spencer, non-circular (dynamic programming) (Baker, Frydman & Talesnick (1993)) | 2.410 | 2.5005 | 2.5003 | +3.755 % | +3.747 % |
| V086e Spencer (Tandjiria, Low & Teh) | 1.219 | 1.2044 | 1.2045 | -1.198 % | -1.189 % |
| V093 Spencer, non-circular (Greco (1996)) | 1.330 | 1.3226 | 1.3225 | -0.556 % | -0.564 % |
| V093 Spencer, non-circular (Yamagami & Ueta (1988)) | 1.339 | 1.3226 | 1.3225 | -1.225 % | -1.232 % |
| V057a limit-equilibrium chart (Griffiths & Lane) | 1.460 | 1.4735 | 1.4736 | +0.925 % | +0.932 % |
| V041a Spencer (Duncan & Wright) | 1.600 | 1.5955 | 1.5956 | -0.281 % | -0.275 % |
| V041b Spencer (Duncan & Wright) | 1.600 | 1.5950 | 1.5951 | -0.313 % | -0.306 % |
| V085 Janbu simplified (Duncan & Wright) | 1.630 | 1.6268 | 1.6267 | -0.196 % | -0.202 % |
| **Mean error (n = 123)** | | | | -0.134 % | -0.133 % |
| **Mean absolute error** | | | | 0.949 % | 0.948 % |
| **RMS error** | | | | 1.537 % | 1.533 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-12: Search: first pass with 11 sagittas from 5 % to 95 % of the reference depth on 9 × 11 entry-exit pairs (issue #160)

Compared with 255d8a46. Errors are relative to the reference, in percent. Verification run time: 510 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 43 moved (18 closer to the reference, 25 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V086c Spencer | 1.209 | 1.2063 | 1.2014 | -0.223 % | -0.629 % |
| V086c Morgenstern-Price (half-sine) | 1.218 | 1.2150 | 1.2113 | -0.246 % | -0.550 % |
| V100 Bishop simplified, non-circular | 1.656 | 1.6476 | 1.6511 | -0.507 % | -0.296 % |
| V094 Morgenstern-Price (half-sine), non-circular | 1.389 | 1.3882 | 1.3857 | -0.058 % | -0.238 % |
| V036a Spencer, non-circular | 0.740 | 0.7360 | 0.7373 | -0.541 % | -0.365 % |
| V003 Bishop simplified | 1.115 | 1.1140 | 1.1155 | -0.090 % | +0.045 % |
| V039 Spencer, non-circular | 1.167 | 1.1618 | 1.1604 | -0.446 % | -0.566 % |
| V028 Bishop simplified | 1.126 | 1.1246 | 1.1233 | -0.124 % | -0.240 % |
| V052a Janbu corrected | 1.949 | 1.9516 | 1.9496 | +0.133 % | +0.031 % |
| V036a Spencer | 0.756 | 0.7521 | 0.7515 | -0.516 % | -0.595 % |
| V036a Bishop simplified | 0.761 | 0.7568 | 0.7564 | -0.552 % | -0.604 % |
| V036b Spencer | 0.898 | 0.8983 | 0.8979 | +0.033 % | -0.011 % |
| V004a Spencer | 2.794 | 2.8021 | 2.8033 | +0.290 % | +0.333 % |
| V094 Spencer, non-circular | 1.398 | 1.3985 | 1.3990 | +0.036 % | +0.072 % |
| V041b Spencer, non-circular | 1.590 | 1.5890 | 1.5895 | -0.063 % | -0.031 % |
| V004a Janbu simplified | 2.662 | 2.6771 | 2.6764 | +0.567 % | +0.541 % |
| V032a Bishop simplified | 1.230 | 1.2247 | 1.2244 | -0.431 % | -0.455 % |
| V036b Bishop simplified | 0.909 | 0.9060 | 0.9058 | -0.330 % | -0.352 % |
| V009c Spencer, non-circular | 1.868 | 1.8671 | 1.8667 | -0.048 % | -0.070 % |
| V052a Bishop simplified | 1.950 | 1.9481 | 1.9477 | -0.072 % | -0.092 % |
| V033 Spencer, non-circular | 1.534 | 1.5221 | 1.5224 | -0.776 % | -0.756 % |
| V026 Spencer, non-circular | 1.190 | 1.1702 | 1.1704 | -1.664 % | -1.647 % |
| V026 Bishop simplified | 1.228 | 1.2203 | 1.2201 | -0.627 % | -0.643 % |
| V052a Spencer | 1.948 | 1.9480 | 1.9477 | 0.000 % | -0.015 % |
| V093 Spencer, non-circular | 1.325 | 1.3224 | 1.3226 | -0.196 % | -0.181 % |
| V041a Spencer, non-circular | 1.592 | 1.5911 | 1.5913 | -0.057 % | -0.044 % |
| V047b Morgenstern-Price (half-sine) | 1.660 | 1.6561 | 1.6559 | -0.235 % | -0.247 % |
| V047b Bishop simplified | 1.664 | 1.6592 | 1.6590 | -0.288 % | -0.300 % |
| V038 Bishop simplified, circles only | 1.080 | 1.0707 | 1.0706 | -0.861 % | -0.870 % |
| V032b Bishop simplified | 1.155 | 1.1548 | 1.1547 | -0.017 % | -0.026 % |
| V096b Morgenstern-Price (half-sine) | 1.174 | 1.1731 | 1.1732 | -0.077 % | -0.068 % |
| V096b Bishop simplified | 1.176 | 1.1745 | 1.1746 | -0.128 % | -0.119 % |
| V059c Spencer, non-circular | 1.315 | 1.3118 | 1.3119 | -0.243 % | -0.236 % |
| V093 Bishop simplified | 1.344 | 1.3431 | 1.3430 | -0.067 % | -0.074 % |
| V082d Morgenstern-Price (half-sine) | 1.378 | 1.3714 | 1.3715 | -0.479 % | -0.472 % |
| V001 Spencer, non-circular | 1.386 | 1.3837 | 1.3836 | -0.166 % | -0.173 % |
| V073 Bishop simplified, circles only | 1.417 | 1.4108 | 1.4109 | -0.438 % | -0.430 % |
| V040 Bishop simplified, circles only | 1.461 | 1.4594 | 1.4595 | -0.110 % | -0.103 % |
| V100 Janbu simplified, non-circular | 1.563 | 1.5589 | 1.5588 | -0.262 % | -0.269 % |
| V085 Janbu simplified | 1.628 | 1.6267 | 1.6268 | -0.080 % | -0.074 % |
| V104b Bishop simplified | 1.770 | 1.7660 | 1.7659 | -0.226 % | -0.232 % |
| V104a Bishop simplified | 2.300 | 2.2919 | 2.2918 | -0.352 % | -0.357 % |
| V004b Janbu simplified | 2.610 | 2.6091 | 2.6090 | -0.034 % | -0.038 % |
| **Mean error (n = 301)** | | | | -0.203 % | -0.206 % |
| **Mean absolute error** | | | | 0.308 % | 0.311 % |
| **RMS error** | | | | 0.441 % | 0.443 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 25 moved (16 closer to the reference, 9 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V005 infinite slope (Theory) | 2.500 | 2.5121 | 2.5018 | +0.484 % | +0.072 % |
| V086c Spencer (Tandjiria, Low & Teh (2002)) | 1.219 | 1.2063 | 1.2014 | -1.042 % | -1.444 % |
| V005 Spencer, non-circular (dynamic programming) (Baker, Frydman & Talesnick (1993)) | 2.410 | 2.5046 | 2.5005 | +3.925 % | +3.755 % |
| V002 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.405 | 0.3926 | 0.3920 | -3.062 % | -3.210 % |
| V003 Bishop simplified (Arai & Tagyo (1985)) | 1.138 | 1.1140 | 1.1155 | -2.109 % | -1.977 % |
| V039 Spencer, non-circular (Duncan & Wright) | 1.160 | 1.1618 | 1.1604 | +0.155 % | +0.034 % |
| V036a Spencer (Duncan & Wright) | 0.750 | 0.7521 | 0.7515 | +0.280 % | +0.200 % |
| V086e Spencer (Tandjiria, Low & Teh) | 1.219 | 1.2051 | 1.2044 | -1.140 % | -1.198 % |
| V002 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 0.430 | 0.4120 | 0.4118 | -4.186 % | -4.233 % |
| V036b Spencer (Duncan & Wright) | 0.900 | 0.8983 | 0.8979 | -0.189 % | -0.233 % |
| V094 Spencer, non-circular (Greco (1996)) | 1.400 | 1.3985 | 1.3990 | -0.107 % | -0.071 % |
| V009c Spencer, non-circular (Baker & Leshchinsky (2001)) | 1.910 | 1.8671 | 1.8667 | -2.246 % | -2.267 % |
| V028 Spencer (Duncan & Wright) | 1.124 | 1.1246 | 1.1244 | +0.053 % | +0.036 % |
| V069a stability chart (Morgenstern) | 1.200 | 1.2007 | 1.2009 | +0.058 % | +0.075 % |
| V026 Bishop simplified (Duncan & Wright) | 1.220 | 1.2203 | 1.2201 | +0.025 % | +0.008 % |
| V093 Spencer, non-circular (Greco (1996)) | 1.330 | 1.3224 | 1.3226 | -0.571 % | -0.556 % |
| V093 Spencer, non-circular (Yamagami & Ueta (1988)) | 1.339 | 1.3224 | 1.3226 | -1.240 % | -1.225 % |
| V086d Spencer (Tandjiria, Low & Teh) | 0.981 | 0.9731 | 0.9732 | -0.805 % | -0.795 % |
| V003 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.995 | 0.9660 | 0.9661 | -2.915 % | -2.905 % |
| V003 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 1.071 | 1.0470 | 1.0471 | -2.241 % | -2.232 % |
| V026 Spencer (Duncan & Wright) | 1.190 | 1.1955 | 1.1954 | +0.462 % | +0.454 % |
| V093 Bishop simplified (Yamagami & Ueta (1988)) | 1.348 | 1.3431 | 1.3430 | -0.364 % | -0.371 % |
| V040 Bishop simplified (El-Ramly et al. (2002)) | 1.460 | 1.4594 | 1.4595 | -0.041 % | -0.034 % |
| V100 Janbu simplified (uncorrected), non-circular (Jiang, Baker & Yamagami) | 1.560 | 1.5589 | 1.5588 | -0.071 % | -0.077 % |
| V085 Janbu simplified (Duncan & Wright) | 1.630 | 1.6267 | 1.6268 | -0.202 % | -0.196 % |
| **Mean error (n = 123)** | | | | -0.123 % | -0.134 % |
| **Mean absolute error** | | | | 0.951 % | 0.949 % |
| **RMS error** | | | | 1.536 % | 1.537 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-12: Search: a pair given right to left gets its circle tangent to a material interface

Compared with c9cfa3ae. Errors are relative to the reference, in percent. Verification run time: 523 s (4 workers, load 3.7 at start).

**Against other programs (midpoint of their range):** 3 moved (2 closer to the reference, 1 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V094 Spencer, non-circular | 1.398 | 1.4000 | 1.3985 | +0.143 % | +0.036 % |
| V094 Morgenstern-Price (half-sine), non-circular | 1.389 | 1.3885 | 1.3882 | -0.036 % | -0.058 % |
| V009c Spencer, non-circular | 1.868 | 1.8668 | 1.8671 | -0.064 % | -0.048 % |
| **Mean error (n = 301)** | | | | -0.203 % | -0.203 % |
| **Mean absolute error** | | | | 0.308 % | 0.308 % |
| **RMS error** | | | | 0.441 % | 0.441 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 3 moved (1 closer to the reference, 2 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V002 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 0.430 | 0.4131 | 0.4120 | -3.930 % | -4.186 % |
| V094 Spencer, non-circular (Greco (1996)) | 1.400 | 1.4000 | 1.3985 | 0.000 % | -0.107 % |
| V009c Spencer, non-circular (Baker & Leshchinsky (2001)) | 1.910 | 1.8668 | 1.8671 | -2.262 % | -2.246 % |
| **Mean error (n = 123)** | | | | -0.120 % | -0.123 % |
| **Mean absolute error** | | | | 0.948 % | 0.951 % |
| **RMS error** | | | | 1.531 % | 1.536 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-12: Local search: the unmoved end of a seed on a search limit is kept (limit tolerance 1e-9, as for the surfaces)

Compared with 38db95b6. Errors are relative to the reference, in percent. Verification run time: 567 s (4 workers, load 2.5 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.203 % | -0.203 % |
| **Mean absolute error** | | | | 0.308 % | 0.308 % |
| **RMS error** | | | | 0.441 % | 0.441 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.120 % | -0.120 % |
| **Mean absolute error** | | | | 0.948 % | 0.948 % |
| **RMS error** | | | | 1.531 % | 1.531 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-12: Search: a side given as a point gets one point in the first pass; a point on a corner is the two ends of its widened limit (issue #157)

Compared with f1a2a2b0. Errors are relative to the reference, in percent. Verification run time: 548 s (4 workers, load 3.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.203 % | -0.203 % |
| **Mean absolute error** | | | | 0.308 % | 0.308 % |
| **RMS error** | | | | 0.441 % | 0.441 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.120 % | -0.120 % |
| **Mean absolute error** | | | | 0.948 % | 0.948 % |
| **RMS error** | | | | 1.531 % | 1.531 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-11: Search: a single exit x on a vertical ground face exits at the foot of the face

Compared with cd31e804. Errors are relative to the reference, in percent. Verification run time: 600 s (4 workers, load 2.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.203 % | -0.203 % |
| **Mean absolute error** | | | | 0.308 % | 0.308 % |
| **RMS error** | | | | 0.441 % | 0.441 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.120 % | -0.120 % |
| **Mean absolute error** | | | | 0.948 % | 0.948 % |
| **RMS error** | | | | 1.531 % | 1.531 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-11: Reinforcement: active (prestressed) elements always carry their force; the tension-only rule is for passive elements

Compared with cb8ab902. Errors are relative to the reference, in percent. Verification run time: 1308 s (4 workers, load 2.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.203 % | -0.203 % |
| **Mean absolute error** | | | | 0.308 % | 0.308 % |
| **RMS error** | | | | 0.441 % | 0.441 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.120 % | -0.120 % |
| **Mean absolute error** | | | | 0.948 % | 0.948 % |
| **RMS error** | | | | 1.531 % | 1.531 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-11: Slices of a circle without the steep-end cuts (V068 tolerance +1 % for a slicing-sensitive surface)

Compared with c44f1f9e. Errors are relative to the reference, in percent. Verification run time: 638 s (4 workers, load 1.1 at start).

The maintainer's decision of 2026-11-11 (DECISIONS.md): the steep ends of a circle are no longer cut into narrower slices. V068 (Bishop on Low's (1989) circle, whose upper end is a vertical scarp) goes from 1.1423 to 1.1607, +1.82 % against Low's 1.14; its tolerance goes from 1.44 % to 2.44 % by the new `slicingSensitive` rule (tolerance.ts), so all 414 checks agree. The golden results (packages/engine-rs/golden/verification.json) were regenerated with tools/golden.ts: 165 of 356 analyses moved (mean +0.04 %, from −0.17 % on V091 to +1.61 % on V068), and V068's stored tolerance changed with them.

**Against other programs (midpoint of their range):** 113 moved (86 closer to the reference, 27 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V065 Spencer | 0.964 | 0.9584 | 0.9603 | -0.581 % | -0.384 % |
| V010 Bishop simplified | 1.170 | 1.1637 | 1.1658 | -0.538 % | -0.359 % |
| V010 Morgenstern-Price (half-sine) | 1.171 | 1.1623 | 1.1644 | -0.743 % | -0.564 % |
| V091 Janbu corrected | 1.385 | 1.3916 | 1.3893 | +0.477 % | +0.310 % |
| V017a Bishop simplified | 1.373 | 1.3823 | 1.3843 | +0.677 % | +0.823 % |
| V017b Bishop simplified | 1.378 | 1.3823 | 1.3843 | +0.312 % | +0.457 % |
| V011a Bishop simplified | 1.230 | 1.2196 | 1.2212 | -0.846 % | -0.715 % |
| V104b Bishop simplified | 1.770 | 1.7637 | 1.7660 | -0.356 % | -0.226 % |
| V017a Spencer | 1.386 | 1.3983 | 1.4001 | +0.887 % | +1.017 % |
| V034a Spencer, non-circular | 1.262 | 1.2595 | 1.2579 | -0.198 % | -0.325 % |
| V022b Morgenstern-Price (half-sine) | 1.178 | 1.1747 | 1.1757 | -0.280 % | -0.195 % |
| V029 Bishop simplified | 1.125 | 1.1185 | 1.1194 | -0.578 % | -0.498 % |
| V081b Bishop simplified | 1.504 | 1.5010 | 1.5022 | -0.199 % | -0.120 % |
| V091 Bishop simplified | 1.241 | 1.2367 | 1.2376 | -0.346 % | -0.274 % |
| V091 Spencer | 1.241 | 1.2367 | 1.2376 | -0.346 % | -0.274 % |
| V091 Morgenstern-Price (half-sine) | 1.244 | 1.2367 | 1.2376 | -0.587 % | -0.514 % |
| V028 Bishop simplified | 1.126 | 1.1238 | 1.1246 | -0.195 % | -0.124 % |
| V032a Spencer | 1.209 | 1.2049 | 1.2057 | -0.339 % | -0.273 % |
| V032a Bishop simplified | 1.230 | 1.2239 | 1.2247 | -0.496 % | -0.431 % |
| V030 Bishop simplified | 1.412 | 1.4082 | 1.4091 | -0.269 % | -0.205 % |
| V016c Bishop simplified | 1.790 | 1.7903 | 1.7914 | +0.017 % | +0.078 % |
| V057a Spencer | 1.468 | 1.4726 | 1.4735 | +0.313 % | +0.375 % |
| V096b Morgenstern-Price (half-sine) | 1.174 | 1.1724 | 1.1731 | -0.136 % | -0.077 % |
| V096b Bishop simplified | 1.176 | 1.1738 | 1.1745 | -0.187 % | -0.128 % |
| V022b Bishop simplified | 1.185 | 1.1773 | 1.1780 | -0.650 % | -0.591 % |
| V096b Spencer | 1.189 | 1.1871 | 1.1878 | -0.160 % | -0.101 % |
| V036c Spencer | 1.032 | 1.0281 | 1.0287 | -0.378 % | -0.320 % |
| V036b Spencer | 0.898 | 0.8978 | 0.8983 | -0.022 % | +0.033 % |
| V036b Bishop simplified | 0.909 | 0.9055 | 0.9060 | -0.385 % | -0.330 % |
| V104d Bishop simplified | 1.330 | 1.3325 | 1.3332 | +0.188 % | +0.241 % |
| V034b Bishop simplified | 1.335 | 1.3296 | 1.3303 | -0.404 % | -0.352 % |
| V036d Bishop simplified | 1.154 | 1.1514 | 1.1520 | -0.225 % | -0.173 % |
| V026 Bishop simplified | 1.228 | 1.2197 | 1.2203 | -0.676 % | -0.627 % |
| V036c Bishop simplified | 1.045 | 1.0419 | 1.0424 | -0.297 % | -0.249 % |
| V104c Bishop simplified | 1.470 | 1.4618 | 1.4625 | -0.558 % | -0.510 % |
| V034a Bishop simplified | 1.313 | 1.3057 | 1.3063 | -0.556 % | -0.510 % |
| V003 Bishop simplified | 1.115 | 1.1135 | 1.1140 | -0.135 % | -0.090 % |
| V016a Bishop simplified | 1.788 | 1.7904 | 1.7912 | +0.106 % | +0.151 % |
| V016a Spencer | 1.791 | 1.7974 | 1.7982 | +0.357 % | +0.402 % |
| V036d Spencer | 1.134 | 1.1311 | 1.1316 | -0.256 % | -0.212 % |
| V036a Spencer | 0.756 | 0.7518 | 0.7521 | -0.556 % | -0.516 % |
| V036a Bishop simplified | 0.761 | 0.7565 | 0.7568 | -0.591 % | -0.552 % |
| V096a Morgenstern-Price (half-sine) | 1.790 | 1.7796 | 1.7803 | -0.581 % | -0.542 % |
| V096a Bishop simplified | 1.804 | 1.7932 | 1.7939 | -0.599 % | -0.560 % |
| V096c Bishop simplified | 1.804 | 1.7989 | 1.7996 | -0.283 % | -0.244 % |
| V003 Spencer | 1.118 | 1.1143 | 1.1147 | -0.331 % | -0.295 % |
| V096c Spencer | 1.804 | 1.7993 | 1.7999 | -0.261 % | -0.227 % |
| V096a Spencer | 1.804 | 1.7941 | 1.7947 | -0.549 % | -0.516 % |
| V016b Bishop simplified | 1.833 | 1.8302 | 1.8308 | -0.126 % | -0.093 % |
| V012 Bishop simplified | 0.980 | 0.9816 | 0.9819 | +0.163 % | +0.194 % |
| V105b Bishop simplified | 1.004 | 1.0038 | 1.0041 | -0.020 % | +0.010 % |
| V016b Spencer | 1.839 | 1.8354 | 1.8359 | -0.196 % | -0.169 % |
| V076 Bishop simplified | 1.147 | 1.1427 | 1.1430 | -0.375 % | -0.349 % |
| V033 Bishop simplified | 1.533 | 1.5214 | 1.5218 | -0.757 % | -0.731 % |
| V034b Spencer, non-circular | 1.182 | 1.1683 | 1.1680 | -1.159 % | -1.184 % |
| V076 Spencer | 1.145 | 1.1407 | 1.1409 | -0.376 % | -0.358 % |
| V011b Bishop simplified | 1.220 | 1.2165 | 1.2167 | -0.287 % | -0.270 % |
| V071a Bishop simplified | 1.293 | 1.2903 | 1.2905 | -0.209 % | -0.193 % |
| V035b Bishop simplified | 1.324 | 1.3207 | 1.3209 | -0.249 % | -0.234 % |
| V101 Bishop simplified | 1.341 | 1.3338 | 1.3340 | -0.574 % | -0.559 % |
| V049 Janbu corrected | 1.357 | 1.3555 | 1.3557 | -0.111 % | -0.096 % |
| V031b Spencer | 1.359 | 1.3519 | 1.3521 | -0.522 % | -0.508 % |
| V019 Spencer (40 slices, vertical pore-pressure head) | 1.389 | 1.3986 | 1.3988 | +0.691 % | +0.706 % |
| V031b Bishop simplified | 1.398 | 1.3893 | 1.3895 | -0.622 % | -0.608 % |
| V049 Bishop simplified | 1.404 | 1.4030 | 1.4032 | -0.071 % | -0.057 % |
| V001 Morgenstern-Price (half-sine) | 1.414 | 1.4011 | 1.4013 | -0.912 % | -0.898 % |
| V035a Morgenstern-Price (half-sine) | 1.575 | 1.5685 | 1.5687 | -0.413 % | -0.400 % |
| V086b Spencer (2 m tension crack) | 0.975 | 0.9684 | 0.9685 | -0.677 % | -0.667 % |
| V086b Morgenstern-Price (half-sine) | 0.975 | 0.9684 | 0.9685 | -0.677 % | -0.667 % |
| V036c Spencer, non-circular | 1.018 | 1.0166 | 1.0165 | -0.138 % | -0.147 % |
| V054 Bishop simplified | 1.087 | 1.0859 | 1.0860 | -0.101 % | -0.092 % |
| V095a Bishop simplified | 1.102 | 1.1009 | 1.1010 | -0.100 % | -0.091 % |
| V021c Bishop simplified | 1.108 | 1.1087 | 1.1088 | +0.063 % | +0.072 % |
| V021c Morgenstern-Price (half-sine) | 1.110 | 1.1087 | 1.1088 | -0.117 % | -0.108 % |
| V036d Spencer, non-circular | 1.116 | 1.1191 | 1.1192 | +0.278 % | +0.287 % |
| V027 Bishop simplified | 1.126 | 1.1232 | 1.1233 | -0.249 % | -0.240 % |
| V021a Morgenstern-Price (half-sine) | 1.132 | 1.1286 | 1.1287 | -0.300 % | -0.292 % |
| V025 Spencer | 1.142 | 1.1328 | 1.1329 | -0.806 % | -0.797 % |
| V025 Bishop simplified | 1.142 | 1.1327 | 1.1328 | -0.814 % | -0.806 % |
| V097a Bishop simplified | 1.173 | 1.1724 | 1.1725 | -0.051 % | -0.043 % |
| V026 Spencer, non-circular | 1.190 | 1.1701 | 1.1702 | -1.672 % | -1.664 % |
| V095c Bishop simplified | 1.193 | 1.1959 | 1.1960 | +0.243 % | +0.251 % |
| V086c Spencer | 1.209 | 1.2062 | 1.2063 | -0.232 % | -0.223 % |
| V031a Spencer | 2.545 | 2.5307 | 2.5309 | -0.562 % | -0.554 % |
| V031a Bishop simplified | 2.549 | 2.5338 | 2.5340 | -0.596 % | -0.588 % |
| V072b Bishop simplified | 1.285 | 1.2821 | 1.2822 | -0.226 % | -0.218 % |
| V072a Bishop simplified | 1.285 | 1.2827 | 1.2828 | -0.179 % | -0.171 % |
| V007c Janbu simplified | 1.291 | 1.2902 | 1.2903 | -0.062 % | -0.054 % |
| V071a Spencer | 1.300 | 1.2971 | 1.2972 | -0.223 % | -0.215 % |
| V020 Spencer | 1.337 | 1.3330 | 1.3331 | -0.299 % | -0.292 % |
| V086a Spencer | 1.341 | 1.3332 | 1.3333 | -0.582 % | -0.574 % |
| V020 Bishop simplified | 1.342 | 1.3374 | 1.3375 | -0.343 % | -0.335 % |
| V093 Bishop simplified | 1.344 | 1.3430 | 1.3431 | -0.074 % | -0.067 % |
| V098 Spencer, non-circular | 1.360 | 1.3568 | 1.3567 | -0.235 % | -0.243 % |
| V098 Spencer | 1.372 | 1.3723 | 1.3724 | +0.022 % | +0.029 % |
| V049 Spencer | 1.375 | 1.3723 | 1.3724 | -0.196 % | -0.189 % |
| V049 Morgenstern-Price (half-sine) | 1.382 | 1.3718 | 1.3719 | -0.738 % | -0.731 % |
| V019 Bishop simplified | 1.401 | 1.4011 | 1.4012 | +0.007 % | +0.014 % |
| V001 Bishop simplified | 1.413 | 1.4043 | 1.4044 | -0.616 % | -0.609 % |
| V021g Morgenstern-Price (half-sine) | 1.422 | 1.4286 | 1.4287 | +0.464 % | +0.471 % |
| V067 Bishop simplified | 1.439 | 1.4361 | 1.4362 | -0.202 % | -0.195 % |
| V008a Spencer | 1.536 | 1.5189 | 1.5190 | -1.113 % | -1.107 % |
| V013b Bishop simplified | 1.540 | 1.5410 | 1.5411 | +0.065 % | +0.071 % |
| V024 Spencer | 1.557 | 1.5626 | 1.5627 | +0.360 % | +0.366 % |
| V024 Bishop simplified | 1.567 | 1.5722 | 1.5723 | +0.300 % | +0.306 % |
| V037 Spencer | 1.620 | 1.6074 | 1.6075 | -0.778 % | -0.772 % |
| V037 Bishop simplified | 1.629 | 1.6135 | 1.6136 | -0.952 % | -0.945 % |
| V058 Spencer | 1.915 | 1.9164 | 1.9165 | +0.073 % | +0.078 % |
| V021e Bishop simplified | 2.245 | 2.2456 | 2.2457 | +0.027 % | +0.031 % |
| V021e Morgenstern-Price (half-sine) | 2.248 | 2.2456 | 2.2457 | -0.107 % | -0.102 % |
| V104a Bishop simplified | 2.300 | 2.2918 | 2.2919 | -0.357 % | -0.352 % |
| V060a Bishop simplified | 2.529 | 2.5301 | 2.5302 | +0.043 % | +0.047 % |
| V062e Bishop simplified | 2.697 | 2.6901 | 2.6902 | -0.274 % | -0.271 % |
| **Mean error (n = 301)** | | | | -0.215 % | -0.203 % |
| **Mean absolute error** | | | | 0.316 % | 0.308 % |
| **RMS error** | | | | 0.447 % | 0.441 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 53 moved (29 closer to the reference, 24 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V068 Bishop simplified (Low) | 1.140 | 1.1423 | 1.1607 | +0.202 % | +1.816 % |
| V065 Spencer, three-part wedge (Leshchinsky & Han (2004)) | 0.920 | 0.9584 | 0.9603 | +4.174 % | +4.380 % |
| V065 Bishop simplified, deep circle (read from fig. 7a) (Leshchinsky & Han (2004)) | 0.980 | 0.9769 | 0.9787 | -0.316 % | -0.133 % |
| V065 Bishop simplified, circular (Leshchinsky & Han (2004)) | 1.000 | 0.9769 | 0.9787 | -2.310 % | -2.130 % |
| V096e Morgenstern-Price (half-sine) (Zhu & Lee) | 1.197 | 1.1973 | 1.1993 | +0.025 % | +0.192 % |
| V096e Spencer (Zhu & Lee) | 1.211 | 1.2124 | 1.2143 | +0.116 % | +0.273 % |
| V028 Spencer (Duncan & Wright) | 1.124 | 1.1234 | 1.1246 | -0.053 % | +0.053 % |
| V029 Spencer (Duncan & Wright) | 1.119 | 1.1185 | 1.1194 | -0.045 % | +0.036 % |
| V096d Morgenstern-Price (half-sine) (Zhu & Lee) | 1.823 | 1.8083 | 1.8097 | -0.806 % | -0.730 % |
| V027 Spencer (Duncan & Wright) | 1.124 | 1.1348 | 1.1356 | +0.961 % | +1.032 % |
| V096d Spencer (Zhu & Lee) | 1.836 | 1.8238 | 1.8251 | -0.664 % | -0.594 % |
| V034a Spencer (Duncan & Wright) | 1.276 | 1.2759 | 1.2768 | -0.008 % | +0.063 % |
| V032a Spencer (Duncan & Wright) | 1.210 | 1.2049 | 1.2057 | -0.421 % | -0.355 % |
| V030 Spencer (Duncan & Wright) | 1.400 | 1.3988 | 1.3997 | -0.086 % | -0.021 % |
| V057a limit-equilibrium chart (Griffiths & Lane) | 1.460 | 1.4726 | 1.4735 | +0.863 % | +0.925 % |
| V022b Bishop simplified (Chowdhury & Xu (1995)) | 1.148 | 1.1773 | 1.1780 | +2.561 % | +2.622 % |
| V036c Spencer (Duncan & Wright) | 1.030 | 1.0281 | 1.0287 | -0.184 % | -0.126 % |
| V086e Spencer (Tandjiria, Low & Teh) | 1.219 | 1.2044 | 1.2051 | -1.198 % | -1.140 % |
| V036b Spencer (Duncan & Wright) | 0.900 | 0.8978 | 0.8983 | -0.244 % | -0.189 % |
| V026 Spencer (Duncan & Wright) | 1.190 | 1.1949 | 1.1955 | +0.412 % | +0.462 % |
| V026 Bishop simplified (Duncan & Wright) | 1.220 | 1.2197 | 1.2203 | -0.025 % | +0.025 % |
| V034b Spencer (Duncan & Wright) | 1.328 | 1.3278 | 1.3284 | -0.015 % | +0.030 % |
| V036d Spencer (Duncan & Wright) | 1.130 | 1.1311 | 1.1316 | +0.097 % | +0.142 % |
| V003 Bishop simplified (Arai & Tagyo (1985)) | 1.138 | 1.1135 | 1.1140 | -2.153 % | -2.109 % |
| V010b Bishop simplified (Borges & Cardoso) | 1.150 | 1.1586 | 1.1591 | +0.748 % | +0.791 % |
| V036a Spencer (Duncan & Wright) | 0.750 | 0.7518 | 0.7521 | +0.240 % | +0.280 % |
| V044b Bishop simplified (Fredlund & Krahn) | 1.766 | 1.7597 | 1.7602 | -0.357 % | -0.328 % |
| V045 Morgenstern-Price (half-sine) (Fredlund & Krahn) | 1.832 | 1.8272 | 1.8277 | -0.262 % | -0.235 % |
| V044 Spencer (Fredlund & Krahn) | 2.073 | 2.0724 | 2.0729 | -0.029 % | -0.005 % |
| V044 Morgenstern-Price (half-sine) (Fredlund & Krahn) | 2.076 | 2.0719 | 2.0724 | -0.197 % | -0.173 % |
| V044 Bishop simplified (Fredlund & Krahn) | 2.080 | 2.0762 | 2.0767 | -0.183 % | -0.159 % |
| V044b Spencer (Fredlund & Krahn) | 1.761 | 1.7579 | 1.7583 | -0.176 % | -0.153 % |
| V044b Morgenstern-Price (half-sine) (Fredlund & Krahn) | 1.764 | 1.7572 | 1.7576 | -0.385 % | -0.363 % |
| V045 Spencer (Fredlund & Krahn) | 1.830 | 1.8280 | 1.8284 | -0.109 % | -0.087 % |
| V045 Bishop simplified (Fredlund & Krahn) | 1.834 | 1.8295 | 1.8299 | -0.245 % | -0.224 % |
| V033 Spencer (Duncan & Wright) | 1.529 | 1.5333 | 1.5336 | +0.281 % | +0.301 % |
| V035b Bishop simplified (Duncan & Wright) | 1.320 | 1.3207 | 1.3209 | +0.053 % | +0.068 % |
| V101 Bishop simplified (Hassan & Wolff) | 1.334 | 1.3338 | 1.3340 | -0.015 % | 0.000 % |
| V031b Spencer (Duncan & Wright) | 1.350 | 1.3519 | 1.3521 | +0.141 % | +0.156 % |
| V086b Spencer (Tandjiria, Low & Teh (2002)) | 0.981 | 0.9684 | 0.9685 | -1.284 % | -1.274 % |
| V003 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 1.071 | 1.0471 | 1.0470 | -2.232 % | -2.241 % |
| V021c Bishop simplified (Chowdhury & Xu) | 1.110 | 1.1087 | 1.1088 | -0.081 % | -0.072 % |
| V021a Bishop simplified (Chowdhury & Xu) | 1.118 | 1.1286 | 1.1287 | +0.966 % | +0.975 % |
| V086c Spencer (Tandjiria, Low & Teh (2002)) | 1.219 | 1.2062 | 1.2063 | -1.050 % | -1.042 % |
| V031a Spencer (Duncan & Wright) | 2.560 | 2.5307 | 2.5309 | -1.145 % | -1.137 % |
| V020 Spencer (Cheng et al.) | 1.330 | 1.3330 | 1.3331 | +0.226 % | +0.233 % |
| V093 Bishop simplified (Yamagami & Ueta (1988)) | 1.348 | 1.3430 | 1.3431 | -0.371 % | -0.364 % |
| V021g Bishop simplified (Chowdhury & Xu) | 1.424 | 1.4285 | 1.4286 | +0.323 % | +0.330 % |
| V001 Bishop simplified (Arai & Tagyo (1985)) | 1.451 | 1.4043 | 1.4044 | -3.218 % | -3.212 % |
| V024 Bishop simplified (Duncan & Wright) | 1.570 | 1.5722 | 1.5723 | +0.140 % | +0.146 % |
| V037 Spencer (Duncan, Wright & Brandon (2014)) | 1.620 | 1.6074 | 1.6075 | -0.778 % | -0.772 % |
| V058 finite elements (Griffiths & Lane) | 1.900 | 1.9164 | 1.9165 | +0.863 % | +0.868 % |
| V021e Bishop simplified (Chowdhury & Xu) | 2.234 | 2.2456 | 2.2457 | +0.506 % | +0.510 % |
| **Mean error (n = 123)** | | | | -0.153 % | -0.120 % |
| **Mean absolute error** | | | | 0.936 % | 0.948 % |
| **RMS error** | | | | 1.519 % | 1.531 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-11: Rapid drawdown: Kc = 1 envelope from the R envelope per Duncan, Wright & Brandon (2014) Eqs. 9.6–9.7; .gsz import reads the phreatic correction

Compared with e5687a3d. Errors are relative to the reference, in percent. Verification run time: 560 s (4 workers, load 3.8 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.215 % | -0.215 % |
| **Mean absolute error** | | | | 0.316 % | 0.316 % |
| **RMS error** | | | | 0.447 % | 0.447 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.153 % | -0.153 % |
| **Mean absolute error** | | | | 0.936 % | 0.936 % |
| **RMS error** | | | | 1.519 % | 1.519 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-11: Unit weight of water as a model setting (default 9.807, nothing moves)

Compared with 7d45ac22. Errors are relative to the reference, in percent. Verification run time: 573 s (4 workers, load 1.1 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.215 % | -0.215 % |
| **Mean absolute error** | | | | 0.316 % | 0.316 % |
| **RMS error** | | | | 0.447 % | 0.447 % |
| **Largest error** | | | | 2.009 % | 2.009 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.153 % | -0.153 % |
| **Mean absolute error** | | | | 0.936 % | 0.936 % |
| **RMS error** | | | | 1.519 % | 1.519 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.273 % | -0.273 % |
| **Mean absolute error** | | | | 2.016 % | 2.016 % |
| **RMS error** | | | | 2.734 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-11: Unit weight of water 9.807 kN/m³ (ρw·g with standard gravity), was 9.81

Compared with a8b5a8de. Errors are relative to the reference, in percent. Verification run time: 550 s (4 workers, load 4.4 at start).

**Against other programs (midpoint of their range):** 84 moved (50 closer to the reference, 34 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V023 Spencer | 1.145 | 1.1382 | 1.1376 | -0.594 % | -0.646 % |
| V038 Bishop simplified, circles only | 1.080 | 1.0704 | 1.0707 | -0.889 % | -0.861 % |
| V038 Spencer, circles only | 1.100 | 1.0776 | 1.0779 | -2.036 % | -2.009 % |
| V069b Bishop simplified | 1.212 | 1.2099 | 1.2102 | -0.173 % | -0.149 % |
| V105d Spencer | 1.761 | 1.7607 | 1.7611 | -0.017 % | +0.006 % |
| V073 Bishop simplified | 1.392 | 1.3878 | 1.3881 | -0.302 % | -0.280 % |
| V073 Spencer | 1.400 | 1.3957 | 1.3960 | -0.307 % | -0.286 % |
| V073 Bishop simplified, circles only | 1.417 | 1.4105 | 1.4108 | -0.459 % | -0.438 % |
| V070 Bishop simplified | 1.417 | 1.4152 | 1.4155 | -0.127 % | -0.106 % |
| V073 Spencer, circles only | 1.422 | 1.4151 | 1.4154 | -0.485 % | -0.464 % |
| V070 Spencer | 1.422 | 1.4215 | 1.4218 | -0.035 % | -0.014 % |
| V054 Spencer | 1.093 | 1.0915 | 1.0917 | -0.137 % | -0.119 % |
| V075 Spencer | 0.570 | 0.5777 | 0.5778 | +1.351 % | +1.368 % |
| V072b Janbu simplified | 1.141 | 1.1360 | 1.1362 | -0.438 % | -0.421 % |
| V071b Janbu simplified | 1.151 | 1.1486 | 1.1488 | -0.209 % | -0.191 % |
| V096b Morgenstern-Price (half-sine) | 1.174 | 1.1722 | 1.1724 | -0.153 % | -0.136 % |
| V096b Bishop simplified | 1.176 | 1.1736 | 1.1738 | -0.204 % | -0.187 % |
| V092 Janbu corrected | 1.830 | 1.8244 | 1.8247 | -0.306 % | -0.290 % |
| V058 Spencer | 1.915 | 1.9161 | 1.9164 | +0.057 % | +0.073 % |
| V072a Bishop simplified | 1.285 | 1.2825 | 1.2827 | -0.195 % | -0.179 % |
| V072b Bishop simplified | 1.285 | 1.2819 | 1.2821 | -0.241 % | -0.226 % |
| V072a Spencer | 1.290 | 1.2879 | 1.2881 | -0.163 % | -0.147 % |
| V072b Spencer | 1.290 | 1.2875 | 1.2877 | -0.194 % | -0.178 % |
| V071b Bishop simplified | 1.293 | 1.2888 | 1.2890 | -0.325 % | -0.309 % |
| V071a Bishop simplified | 1.293 | 1.2901 | 1.2903 | -0.224 % | -0.209 % |
| V071a Spencer | 1.300 | 1.2969 | 1.2971 | -0.238 % | -0.223 % |
| V071b Spencer | 1.300 | 1.2948 | 1.2950 | -0.400 % | -0.385 % |
| V043 Bishop simplified | 1.320 | 1.3200 | 1.3202 | 0.000 % | +0.015 % |
| V092 Morgenstern-Price (half-sine) | 2.027 | 2.0056 | 2.0059 | -1.056 % | -1.041 % |
| V089 Spencer | 2.736 | 2.7214 | 2.7218 | -0.534 % | -0.519 % |
| V051 Spencer, non-circular | 0.707 | 0.7139 | 0.7140 | +0.976 % | +0.990 % |
| V033 Bishop simplified | 1.533 | 1.5212 | 1.5214 | -0.770 % | -0.757 % |
| V041b Spencer, non-circular | 1.590 | 1.5892 | 1.5890 | -0.050 % | -0.063 % |
| V041a Spencer | 1.599 | 1.5957 | 1.5955 | -0.206 % | -0.219 % |
| V041a Bishop simplified | 1.603 | 1.5985 | 1.5983 | -0.281 % | -0.293 % |
| V089 Janbu corrected | 2.650 | 2.6482 | 2.6485 | -0.068 % | -0.057 % |
| V089 Bishop simplified | 2.716 | 2.6989 | 2.6992 | -0.630 % | -0.619 % |
| V089 Morgenstern-Price (half-sine) | 2.744 | 2.7277 | 2.7280 | -0.594 % | -0.583 % |
| V009c Spencer, non-circular | 1.868 | 1.8666 | 1.8668 | -0.075 % | -0.064 % |
| V092 Bishop simplified | 2.011 | 1.9913 | 1.9915 | -0.980 % | -0.970 % |
| V053 Spencer, non-circular | 1.010 | 1.0061 | 1.0062 | -0.386 % | -0.376 % |
| V092 Spencer | 2.026 | 2.0055 | 2.0057 | -1.012 % | -1.002 % |
| V105c Spencer | 1.085 | 1.0848 | 1.0849 | -0.018 % | -0.009 % |
| V054 Bishop simplified | 1.087 | 1.0858 | 1.0859 | -0.110 % | -0.101 % |
| V003 Bishop simplified | 1.115 | 1.1134 | 1.1135 | -0.143 % | -0.135 % |
| V003 Spencer | 1.118 | 1.1142 | 1.1143 | -0.340 % | -0.331 % |
| V003 Janbu corrected | 1.131 | 1.1303 | 1.1304 | -0.062 % | -0.053 % |
| V025 Bishop simplified | 1.142 | 1.1326 | 1.1327 | -0.823 % | -0.814 % |
| V025 Spencer | 1.142 | 1.1327 | 1.1328 | -0.814 % | -0.806 % |
| V097b Bishop simplified | 1.173 | 1.1725 | 1.1726 | -0.043 % | -0.034 % |
| V097b Spencer | 1.174 | 1.1738 | 1.1739 | -0.017 % | -0.009 % |
| V096b Spencer | 1.189 | 1.1870 | 1.1871 | -0.168 % | -0.160 % |
| V091 Bishop simplified | 1.241 | 1.2368 | 1.2367 | -0.338 % | -0.346 % |
| V091 Spencer | 1.241 | 1.2368 | 1.2367 | -0.338 % | -0.346 % |
| V091 Morgenstern-Price (half-sine) | 1.244 | 1.2368 | 1.2367 | -0.579 % | -0.587 % |
| V105a Bishop simplified | 1.285 | 1.2850 | 1.2851 | 0.000 % | +0.008 % |
| V082d Janbu corrected | 1.345 | 1.3434 | 1.3435 | -0.119 % | -0.112 % |
| V017a Bishop simplified | 1.373 | 1.3822 | 1.3823 | +0.670 % | +0.677 % |
| V082d Bishop simplified | 1.376 | 1.3697 | 1.3698 | -0.458 % | -0.451 % |
| V017b Bishop simplified | 1.378 | 1.3822 | 1.3823 | +0.305 % | +0.312 % |
| V082d Spencer | 1.382 | 1.3762 | 1.3763 | -0.420 % | -0.412 % |
| V017a Spencer | 1.386 | 1.3982 | 1.3983 | +0.880 % | +0.887 % |
| V082c Janbu corrected | 1.391 | 1.3921 | 1.3922 | +0.079 % | +0.086 % |
| V082c Bishop simplified | 1.396 | 1.3962 | 1.3963 | +0.014 % | +0.021 % |
| V082c Spencer | 1.402 | 1.4025 | 1.4026 | +0.036 % | +0.043 % |
| V082b Spencer | 1.510 | 1.5119 | 1.5120 | +0.126 % | +0.132 % |
| V082b Morgenstern-Price (half-sine) | 1.510 | 1.5120 | 1.5121 | +0.132 % | +0.139 % |
| V082b Bishop simplified | 1.511 | 1.5128 | 1.5129 | +0.119 % | +0.126 % |
| V082b Janbu corrected | 1.520 | 1.5217 | 1.5218 | +0.112 % | +0.118 % |
| V082a Spencer | 1.532 | 1.5332 | 1.5333 | +0.078 % | +0.085 % |
| V082a Morgenstern-Price (half-sine) | 1.532 | 1.5332 | 1.5333 | +0.078 % | +0.085 % |
| V082a Bishop simplified | 1.532 | 1.5340 | 1.5341 | +0.131 % | +0.137 % |
| V082a Janbu corrected | 1.544 | 1.5464 | 1.5465 | +0.155 % | +0.162 % |
| V024 Spencer | 1.557 | 1.5625 | 1.5626 | +0.353 % | +0.360 % |
| V024 Bishop simplified | 1.567 | 1.5721 | 1.5722 | +0.293 % | +0.300 % |
| V042 Bishop simplified | 1.584 | 1.5822 | 1.5823 | -0.114 % | -0.107 % |
| V041a Spencer, non-circular | 1.592 | 1.5912 | 1.5911 | -0.050 % | -0.057 % |
| V048 Bishop simplified | 1.596 | 1.5868 | 1.5869 | -0.576 % | -0.570 % |
| V041b Spencer | 1.599 | 1.5951 | 1.5950 | -0.244 % | -0.250 % |
| V041b Bishop simplified | 1.603 | 1.5983 | 1.5982 | -0.293 % | -0.299 % |
| V042 Spencer | 1.648 | 1.6493 | 1.6494 | +0.079 % | +0.085 % |
| V009a Spencer | 1.925 | 1.9264 | 1.9265 | +0.073 % | +0.078 % |
| V087 Janbu corrected | 2.290 | 2.2484 | 2.2485 | -1.817 % | -1.812 % |
| V061 Morgenstern-Price (half-sine) | 2.343 | 2.3483 | 2.3484 | +0.226 % | +0.230 % |
| **Mean error (n = 301)** | | | | -0.217 % | -0.215 % |
| **Mean absolute error** | | | | 0.317 % | 0.316 % |
| **RMS error** | | | | 0.449 % | 0.447 % |
| **Largest error** | | | | 2.036 % | 2.009 % |

**Against the papers:** 28 moved (14 closer to the reference, 14 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V069a stability chart (Morgenstern) | 1.200 | 1.2003 | 1.2007 | +0.025 % | +0.058 % |
| V038b Spencer (Duncan & Wright) | 1.160 | 1.1575 | 1.1578 | -0.216 % | -0.190 % |
| V038b Spencer, finite-element pore pressures (Duncan, Wright & Brandon (2014)) | 1.190 | 1.1575 | 1.1578 | -2.731 % | -2.706 % |
| V070 stability chart (Morgenstern) | 1.410 | 1.4152 | 1.4155 | +0.369 % | +0.390 % |
| V053 Spencer, local minimum (nearly circular surface from the toe) (Greco (1996)) | 1.080 | 1.0915 | 1.0917 | +1.065 % | +1.083 % |
| V054 Spencer, local minimum (nearly circular surface from the toe) (Greco (1996)) | 1.080 | 1.0915 | 1.0917 | +1.065 % | +1.083 % |
| V096e Spencer (Zhu & Lee) | 1.211 | 1.2122 | 1.2124 | +0.099 % | +0.116 % |
| V058 finite elements (Griffiths & Lane) | 1.900 | 1.9161 | 1.9164 | +0.847 % | +0.863 % |
| V043 Bishop simplified (El-Ramly et al.) | 1.310 | 1.3200 | 1.3202 | +0.763 % | +0.779 % |
| V033 Spencer (Duncan & Wright) | 1.529 | 1.5331 | 1.5333 | +0.268 % | +0.281 % |
| V041a Spencer (Duncan & Wright) | 1.600 | 1.5957 | 1.5955 | -0.269 % | -0.281 % |
| V089 Bishop simplified (USACE EM 1110-2-1902) | 2.710 | 2.6989 | 2.6992 | -0.410 % | -0.399 % |
| V009b Spencer (Baker & Leshchinsky) | 1.910 | 1.8817 | 1.8819 | -1.482 % | -1.471 % |
| V009c Spencer, non-circular (Baker & Leshchinsky (2001)) | 1.910 | 1.8666 | 1.8668 | -2.272 % | -2.262 % |
| V053 Spencer, non-circular (global minimum along the weak layer) (Greco (1996)) | 0.970 | 1.0061 | 1.0062 | +3.722 % | +3.732 % |
| V003 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.995 | 0.9659 | 0.9660 | -2.925 % | -2.915 % |
| V053 Spencer, non-circular (test problem 3) (Chen & Shao (1988)) | 1.009 | 1.0061 | 1.0062 | -0.287 % | -0.278 % |
| V003 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 1.071 | 1.0470 | 1.0471 | -2.241 % | -2.232 % |
| V003 Bishop simplified (Arai & Tagyo (1985)) | 1.138 | 1.1134 | 1.1135 | -2.162 % | -2.153 % |
| V096e Morgenstern-Price (half-sine) (Zhu & Lee) | 1.197 | 1.1972 | 1.1973 | +0.017 % | +0.025 % |
| V046b Bishop simplified (Fredlund & Krahn) | 1.248 | 1.2408 | 1.2409 | -0.577 % | -0.569 % |
| V021g Bishop simplified (Chowdhury & Xu) | 1.424 | 1.4284 | 1.4285 | +0.316 % | +0.323 % |
| V024 Bishop simplified (Duncan & Wright) | 1.570 | 1.5721 | 1.5722 | +0.134 % | +0.140 % |
| V041b Spencer (Duncan & Wright) | 1.600 | 1.5951 | 1.5950 | -0.306 % | -0.313 % |
| V045 Spencer (Fredlund & Krahn) | 1.830 | 1.8279 | 1.8280 | -0.115 % | -0.109 % |
| V045 Morgenstern-Price (half-sine) (Fredlund & Krahn) | 1.832 | 1.8271 | 1.8272 | -0.267 % | -0.262 % |
| V045 Bishop simplified (Fredlund & Krahn) | 1.834 | 1.8294 | 1.8295 | -0.251 % | -0.245 % |
| V061 Morgenstern-Price (half-sine) (Wolff & Harr) | 2.360 | 2.3483 | 2.3484 | -0.496 % | -0.492 % |
| **Mean error (n = 123)** | | | | -0.156 % | -0.153 % |
| **Mean absolute error** | | | | 0.936 % | 0.936 % |
| **RMS error** | | | | 1.520 % | 1.519 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 2 moved (2 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V038b finite-element strength reduction, piezometric line (Duncan, Wright & Brandon (2014)) | 1.070 | 1.0655 | 1.0735 | -0.421 % | +0.327 % |
| V045 finite-element strength reduction (verification manual, problem 17) (another program's verification manual) | 1.780 | 1.7854 | 1.7809 | +0.303 % | +0.051 % |
| **Mean error (n = 34)** | | | | -0.288 % | -0.273 % |
| **Mean absolute error** | | | | 2.026 % | 2.016 % |
| **RMS error** | | | | 2.735 % | 2.734 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-11: Slice base of a circle: the straight chord, with the base shear's moment arm to the chord, R·cos(Δθ/2) (Fredlund & Krahn 1977); the steep ends still cut; arc-consistent base removed

Compared with 9ec20820. Errors are relative to the reference, in percent. Verification run time: 534 s (4 workers, load 4.7 at start).

**Against other programs (midpoint of their range):** 209 moved (126 closer to the reference, 83 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V041b Spencer | 1.599 | 1.5931 | 1.5951 | -0.369 % | -0.244 % |
| V041a Spencer | 1.599 | 1.5937 | 1.5957 | -0.331 % | -0.206 % |
| V041b Bishop simplified | 1.603 | 1.5964 | 1.5983 | -0.412 % | -0.293 % |
| V041a Bishop simplified | 1.603 | 1.5966 | 1.5985 | -0.399 % | -0.281 % |
| V003 Janbu corrected | 1.131 | 1.1290 | 1.1303 | -0.177 % | -0.062 % |
| V038 Bishop simplified, circles only | 1.080 | 1.0694 | 1.0704 | -0.981 % | -0.889 % |
| V091 Janbu corrected | 1.385 | 1.3904 | 1.3916 | +0.390 % | +0.477 % |
| V038 Spencer, circles only | 1.100 | 1.0768 | 1.0776 | -2.109 % | -2.036 % |
| V072b Janbu simplified | 1.141 | 1.1352 | 1.1360 | -0.508 % | -0.438 % |
| V071b Janbu simplified | 1.151 | 1.1478 | 1.1486 | -0.278 % | -0.209 % |
| V092 Janbu corrected | 1.830 | 1.8232 | 1.8244 | -0.372 % | -0.306 % |
| V036d Bishop simplified | 1.154 | 1.1521 | 1.1514 | -0.165 % | -0.225 % |
| V036c Bishop simplified | 1.045 | 1.0425 | 1.0419 | -0.239 % | -0.297 % |
| V036c Spencer | 1.032 | 1.0286 | 1.0281 | -0.329 % | -0.378 % |
| V058 Spencer | 1.915 | 1.9152 | 1.9161 | +0.010 % | +0.057 % |
| V092 Bishop simplified | 2.011 | 1.9904 | 1.9913 | -1.024 % | -0.980 % |
| V036b Spencer | 0.898 | 0.8982 | 0.8978 | +0.022 % | -0.022 % |
| V092 Spencer | 2.026 | 2.0046 | 2.0055 | -1.056 % | -1.012 % |
| V036b Bishop simplified | 0.909 | 0.9059 | 0.9055 | -0.341 % | -0.385 % |
| V052a Janbu corrected | 1.949 | 1.9508 | 1.9516 | +0.092 % | +0.133 % |
| V036a Spencer | 0.756 | 0.7521 | 0.7518 | -0.516 % | -0.556 % |
| V034a Spencer, non-circular | 1.262 | 1.2600 | 1.2595 | -0.158 % | -0.198 % |
| V092 Morgenstern-Price (half-sine) | 2.027 | 2.0048 | 2.0056 | -1.095 % | -1.056 % |
| V036a Bishop simplified | 0.761 | 0.7568 | 0.7565 | -0.552 % | -0.591 % |
| V071a Bishop simplified | 1.293 | 1.2896 | 1.2901 | -0.263 % | -0.224 % |
| V071a Spencer | 1.300 | 1.2964 | 1.2969 | -0.277 % | -0.238 % |
| V021d Bishop simplified | 1.058 | 1.0580 | 1.0584 | 0.000 % | +0.038 % |
| V021d Morgenstern-Price (half-sine) | 1.063 | 1.0580 | 1.0584 | -0.470 % | -0.433 % |
| V082d Janbu corrected | 1.345 | 1.3429 | 1.3434 | -0.156 % | -0.119 % |
| V049 Janbu corrected | 1.357 | 1.3550 | 1.3555 | -0.147 % | -0.111 % |
| V062h Bishop simplified | 6.072 | 6.0630 | 6.0652 | -0.140 % | -0.104 % |
| V073 Bishop simplified | 1.392 | 1.3873 | 1.3878 | -0.338 % | -0.302 % |
| V003 Bishop simplified | 1.115 | 1.1130 | 1.1134 | -0.179 % | -0.143 % |
| V021b Morgenstern-Price (half-sine) | 1.116 | 1.1098 | 1.1102 | -0.556 % | -0.520 % |
| V003 Spencer | 1.118 | 1.1138 | 1.1142 | -0.376 % | -0.340 % |
| V073 Spencer | 1.400 | 1.3952 | 1.3957 | -0.343 % | -0.307 % |
| V062i Bishop simplified | 11.583 | 11.5667 | 11.5708 | -0.141 % | -0.105 % |
| V073 Bishop simplified, circles only | 1.417 | 1.4100 | 1.4105 | -0.494 % | -0.459 % |
| V070 Bishop simplified | 1.417 | 1.4147 | 1.4152 | -0.162 % | -0.127 % |
| V036d Spencer | 1.134 | 1.1315 | 1.1311 | -0.220 % | -0.256 % |
| V021g Morgenstern-Price (half-sine) | 1.422 | 1.4281 | 1.4286 | +0.429 % | +0.464 % |
| V073 Spencer, circles only | 1.422 | 1.4146 | 1.4151 | -0.520 % | -0.485 % |
| V070 Spencer | 1.422 | 1.4210 | 1.4215 | -0.070 % | -0.035 % |
| V087 Janbu corrected | 2.290 | 2.2476 | 2.2484 | -1.852 % | -1.817 % |
| V010 Morgenstern-Price (half-sine) | 1.171 | 1.1627 | 1.1623 | -0.709 % | -0.743 % |
| V057a Spencer | 1.468 | 1.4721 | 1.4726 | +0.279 % | +0.313 % |
| V089 Janbu corrected | 2.650 | 2.6473 | 2.6482 | -0.102 % | -0.068 % |
| V069b Bishop simplified | 1.212 | 1.2095 | 1.2099 | -0.206 % | -0.173 % |
| V021f Bishop simplified | 2.128 | 2.1281 | 2.1288 | +0.005 % | +0.038 % |
| V021f Morgenstern-Price (half-sine) | 2.138 | 2.1281 | 2.1288 | -0.463 % | -0.430 % |
| V091 Bishop simplified | 1.241 | 1.2364 | 1.2368 | -0.371 % | -0.338 % |
| V091 Spencer | 1.241 | 1.2364 | 1.2368 | -0.371 % | -0.338 % |
| V091 Morgenstern-Price (half-sine) | 1.244 | 1.2364 | 1.2368 | -0.611 % | -0.579 % |
| V021e Bishop simplified | 2.245 | 2.2449 | 2.2456 | -0.004 % | +0.027 % |
| V021e Morgenstern-Price (half-sine) | 2.248 | 2.2449 | 2.2456 | -0.138 % | -0.107 % |
| V072a Bishop simplified | 1.285 | 1.2821 | 1.2825 | -0.226 % | -0.195 % |
| V072b Bishop simplified | 1.285 | 1.2815 | 1.2819 | -0.272 % | -0.241 % |
| V072b Spencer | 1.290 | 1.2871 | 1.2875 | -0.225 % | -0.194 % |
| V072a Spencer | 1.290 | 1.2875 | 1.2879 | -0.194 % | -0.163 % |
| V071b Bishop simplified | 1.293 | 1.2884 | 1.2888 | -0.356 % | -0.325 % |
| V071b Spencer | 1.300 | 1.2944 | 1.2948 | -0.431 % | -0.400 % |
| V082d Bishop simplified | 1.376 | 1.3693 | 1.3697 | -0.487 % | -0.458 % |
| V082d Morgenstern-Price (half-sine) | 1.378 | 1.3710 | 1.3714 | -0.508 % | -0.479 % |
| V082d Spencer | 1.382 | 1.3758 | 1.3762 | -0.449 % | -0.420 % |
| V082c Janbu corrected | 1.391 | 1.3917 | 1.3921 | +0.050 % | +0.079 % |
| V082c Morgenstern-Price (half-sine) | 1.398 | 1.3981 | 1.3985 | +0.007 % | +0.036 % |
| V062g Bishop simplified | 3.592 | 3.5918 | 3.5928 | -0.006 % | +0.022 % |
| V021c Bishop simplified | 1.108 | 1.1084 | 1.1087 | +0.036 % | +0.063 % |
| V021b Bishop simplified (60 slices) | 1.109 | 1.1098 | 1.1101 | +0.072 % | +0.099 % |
| V021c Morgenstern-Price (half-sine) | 1.110 | 1.1084 | 1.1087 | -0.144 % | -0.117 % |
| V028 Bishop simplified | 1.126 | 1.1235 | 1.1238 | -0.222 % | -0.195 % |
| V021a Morgenstern-Price (half-sine) | 1.132 | 1.1283 | 1.1286 | -0.327 % | -0.300 % |
| V089 Bishop simplified | 2.716 | 2.6982 | 2.6989 | -0.655 % | -0.630 % |
| V010 Bishop simplified | 1.170 | 1.1640 | 1.1637 | -0.513 % | -0.538 % |
| V097a Bishop simplified | 1.173 | 1.1721 | 1.1724 | -0.077 % | -0.051 % |
| V089 Morgenstern-Price (half-sine) | 2.744 | 2.7270 | 2.7277 | -0.620 % | -0.594 % |
| V034b Spencer, non-circular | 1.182 | 1.1686 | 1.1683 | -1.134 % | -1.159 % |
| V034a Bishop simplified | 1.313 | 1.3060 | 1.3057 | -0.533 % | -0.556 % |
| V004a Janbu simplified | 2.662 | 2.6765 | 2.6771 | +0.545 % | +0.567 % |
| V034b Bishop simplified | 1.335 | 1.3299 | 1.3296 | -0.382 % | -0.404 % |
| V096a Morgenstern-Price (half-sine) | 1.790 | 1.7800 | 1.7796 | -0.559 % | -0.581 % |
| V093 Bishop simplified | 1.344 | 1.3427 | 1.3430 | -0.097 % | -0.074 % |
| V090 Janbu corrected | 1.345 | 1.3405 | 1.3408 | -0.335 % | -0.312 % |
| V096c Spencer | 1.804 | 1.7997 | 1.7993 | -0.238 % | -0.261 % |
| V055 Spencer | 1.366 | 1.3662 | 1.3665 | +0.015 % | +0.037 % |
| V089 Spencer | 2.736 | 2.7208 | 2.7214 | -0.556 % | -0.534 % |
| V082c Bishop simplified | 1.396 | 1.3959 | 1.3962 | -0.007 % | +0.014 % |
| V082c Spencer | 1.402 | 1.4022 | 1.4025 | +0.014 % | +0.036 % |
| V009a Spencer | 1.925 | 1.9260 | 1.9264 | +0.052 % | +0.073 % |
| V088 Janbu corrected | 2.430 | 2.4438 | 2.4443 | +0.568 % | +0.588 % |
| V007a Janbu simplified | 1.469 | 1.4683 | 1.4686 | -0.048 % | -0.027 % |
| V012 Bishop simplified | 0.980 | 0.9818 | 0.9816 | +0.184 % | +0.163 % |
| V048 Janbu corrected | 1.489 | 1.4748 | 1.4751 | -0.954 % | -0.934 % |
| V033 Bishop simplified | 1.533 | 1.5209 | 1.5212 | -0.789 % | -0.770 % |
| V024 Spencer | 1.557 | 1.5622 | 1.5625 | +0.334 % | +0.353 % |
| V024 Bishop simplified | 1.567 | 1.5718 | 1.5721 | +0.274 % | +0.293 % |
| V035a Morgenstern-Price (half-sine) | 1.575 | 1.5682 | 1.5685 | -0.432 % | -0.413 % |
| V054 Bishop simplified | 1.087 | 1.0856 | 1.0858 | -0.129 % | -0.110 % |
| V054 Spencer | 1.093 | 1.0913 | 1.0915 | -0.156 % | -0.137 % |
| V095a Bishop simplified | 1.102 | 1.1007 | 1.1009 | -0.118 % | -0.100 % |
| V036d Spencer, non-circular | 1.116 | 1.1193 | 1.1191 | +0.296 % | +0.278 % |
| V029 Bishop simplified | 1.125 | 1.1183 | 1.1185 | -0.596 % | -0.578 % |
| V062b Bishop simplified | 2.813 | 2.8155 | 2.8160 | +0.089 % | +0.107 % |
| V027 Bishop simplified | 1.126 | 1.1230 | 1.1232 | -0.266 % | -0.249 % |
| V021a Bishop simplified (60 slices) | 1.128 | 1.1283 | 1.1285 | +0.027 % | +0.044 % |
| V025 Spencer | 1.142 | 1.1325 | 1.1327 | -0.832 % | -0.814 % |
| V025 Bishop simplified | 1.142 | 1.1324 | 1.1326 | -0.841 % | -0.823 % |
| V022a Morgenstern-Price (half-sine) | 1.158 | 1.1571 | 1.1573 | -0.078 % | -0.060 % |
| V097b Bishop simplified | 1.173 | 1.1723 | 1.1725 | -0.060 % | -0.043 % |
| V096b Morgenstern-Price (half-sine) | 1.174 | 1.1720 | 1.1722 | -0.170 % | -0.153 % |
| V097b Spencer | 1.174 | 1.1736 | 1.1738 | -0.034 % | -0.017 % |
| V096b Bishop simplified | 1.176 | 1.1734 | 1.1736 | -0.221 % | -0.204 % |
| V096b Spencer | 1.189 | 1.1868 | 1.1870 | -0.185 % | -0.168 % |
| V095c Bishop simplified | 1.193 | 1.1957 | 1.1959 | +0.226 % | +0.243 % |
| V096a Bishop simplified | 1.804 | 1.7935 | 1.7932 | -0.582 % | -0.599 % |
| V096c Bishop simplified | 1.804 | 1.7992 | 1.7989 | -0.266 % | -0.283 % |
| V096a Spencer | 1.804 | 1.7944 | 1.7941 | -0.532 % | -0.549 % |
| V086c Spencer | 1.209 | 1.2064 | 1.2062 | -0.215 % | -0.232 % |
| V011b Bishop simplified | 1.220 | 1.2167 | 1.2165 | -0.270 % | -0.287 % |
| V088 Spencer | 2.445 | 2.4416 | 2.4420 | -0.139 % | -0.123 % |
| V088 Bishop simplified | 2.447 | 2.4423 | 2.4427 | -0.192 % | -0.176 % |
| V088 Morgenstern-Price (half-sine) | 2.447 | 2.4416 | 2.4420 | -0.221 % | -0.204 % |
| V011a Bishop simplified | 1.230 | 1.2198 | 1.2196 | -0.829 % | -0.846 % |
| V013e Bishop simplified | 1.250 | 1.2528 | 1.2530 | +0.224 % | +0.240 % |
| V090 Morgenstern-Price (half-sine) | 1.327 | 1.3164 | 1.3166 | -0.799 % | -0.784 % |
| V090 Spencer | 1.328 | 1.3167 | 1.3169 | -0.851 % | -0.836 % |
| V013d Bishop simplified | 1.330 | 1.3314 | 1.3316 | +0.105 % | +0.120 % |
| V090 Bishop simplified | 1.332 | 1.3205 | 1.3207 | -0.863 % | -0.848 % |
| V062f Bishop simplified | 2.673 | 2.6732 | 2.6736 | +0.026 % | +0.041 % |
| V086a Spencer | 1.341 | 1.3330 | 1.3332 | -0.597 % | -0.582 % |
| V098 Spencer | 1.372 | 1.3721 | 1.3723 | +0.007 % | +0.022 % |
| V049 Spencer | 1.375 | 1.3721 | 1.3723 | -0.211 % | -0.196 % |
| V049 Morgenstern-Price (half-sine) | 1.382 | 1.3716 | 1.3718 | -0.753 % | -0.738 % |
| V001 Bishop simplified | 1.413 | 1.4041 | 1.4043 | -0.630 % | -0.616 % |
| V013c Bishop simplified | 1.430 | 1.4371 | 1.4373 | +0.497 % | +0.510 % |
| V067 Bishop simplified | 1.439 | 1.4359 | 1.4361 | -0.215 % | -0.202 % |
| V081b Bishop simplified | 1.504 | 1.5012 | 1.5010 | -0.186 % | -0.199 % |
| V082b Morgenstern-Price (half-sine) | 1.510 | 1.5118 | 1.5120 | +0.119 % | +0.132 % |
| V082b Bishop simplified | 1.511 | 1.5126 | 1.5128 | +0.106 % | +0.119 % |
| V082b Janbu corrected | 1.520 | 1.5215 | 1.5217 | +0.099 % | +0.112 % |
| V082a Bishop simplified | 1.532 | 1.5338 | 1.5340 | +0.117 % | +0.131 % |
| V013b Bishop simplified | 1.540 | 1.5408 | 1.5410 | +0.052 % | +0.065 % |
| V082a Janbu corrected | 1.544 | 1.5462 | 1.5464 | +0.142 % | +0.155 % |
| V042 Bishop simplified | 1.584 | 1.5820 | 1.5822 | -0.126 % | -0.114 % |
| V047b Morgenstern-Price (half-sine) | 1.660 | 1.6559 | 1.6561 | -0.247 % | -0.235 % |
| V016c Bishop simplified | 1.790 | 1.7905 | 1.7903 | +0.028 % | +0.017 % |
| V062c Bishop simplified | 2.774 | 2.7792 | 2.7795 | +0.187 % | +0.198 % |
| V007b Janbu simplified | 0.957 | 0.9553 | 0.9554 | -0.178 % | -0.167 % |
| V065 Spencer | 0.964 | 0.9585 | 0.9584 | -0.571 % | -0.581 % |
| V052a Spencer | 1.948 | 1.9478 | 1.9480 | -0.010 % | 0.000 % |
| V052a Bishop simplified | 1.950 | 1.9479 | 1.9481 | -0.082 % | -0.072 % |
| V086b Spencer (tension crack of automatic depth) | 0.975 | 0.9665 | 0.9666 | -0.872 % | -0.862 % |
| V086b Spencer (2 m tension crack) | 0.975 | 0.9683 | 0.9684 | -0.687 % | -0.677 % |
| V086b Morgenstern-Price (half-sine) | 0.975 | 0.9683 | 0.9684 | -0.687 % | -0.677 % |
| V102b Bishop simplified | 0.988 | 0.9864 | 0.9865 | -0.111 % | -0.101 % |
| V047a Janbu corrected | 0.990 | 0.9855 | 0.9856 | -0.455 % | -0.444 % |
| V102a Bishop simplified | 0.992 | 0.9912 | 0.9913 | -0.081 % | -0.071 % |
| V102a Spencer | 1.001 | 1.0009 | 1.0010 | -0.010 % | 0.000 % |
| V102b Spencer | 1.001 | 1.0006 | 1.0007 | -0.040 % | -0.030 % |
| V105b Bishop simplified | 1.004 | 1.0039 | 1.0038 | -0.010 % | -0.020 % |
| V066a Bishop simplified | 1.040 | 1.0305 | 1.0306 | -0.913 % | -0.904 % |
| V013a Bishop simplified | 1.140 | 1.1429 | 1.1430 | +0.254 % | +0.263 % |
| V023 Spencer | 1.145 | 1.1381 | 1.1382 | -0.603 % | -0.594 % |
| V076 Spencer | 1.145 | 1.1406 | 1.1407 | -0.384 % | -0.376 % |
| V022b Morgenstern-Price (half-sine) | 1.178 | 1.1746 | 1.1747 | -0.289 % | -0.280 % |
| V026 Spencer, non-circular | 1.190 | 1.1702 | 1.1701 | -1.664 % | -1.672 % |
| V086c Morgenstern-Price (half-sine) | 1.218 | 1.2151 | 1.2150 | -0.238 % | -0.246 % |
| V063 Spencer | 2.455 | 2.4511 | 2.4513 | -0.159 % | -0.151 % |
| V026 Bishop simplified | 1.228 | 1.2198 | 1.2197 | -0.668 % | -0.676 % |
| V032a Bishop simplified | 1.230 | 1.2240 | 1.2239 | -0.488 % | -0.496 % |
| V031a Bishop simplified | 2.549 | 2.5336 | 2.5338 | -0.604 % | -0.596 % |
| V105a Bishop simplified | 1.285 | 1.2851 | 1.2850 | +0.008 % | 0.000 % |
| V007c Janbu simplified | 1.291 | 1.2901 | 1.2902 | -0.070 % | -0.062 % |
| V004b Janbu simplified | 2.610 | 2.6089 | 2.6091 | -0.042 % | -0.034 % |
| V035b Bishop simplified | 1.324 | 1.3206 | 1.3207 | -0.257 % | -0.249 % |
| V104d Bishop simplified | 1.330 | 1.3324 | 1.3325 | +0.180 % | +0.188 % |
| V020 Spencer | 1.337 | 1.3329 | 1.3330 | -0.307 % | -0.299 % |
| V101 Bishop simplified | 1.341 | 1.3337 | 1.3338 | -0.581 % | -0.574 % |
| V020 Bishop simplified | 1.342 | 1.3373 | 1.3374 | -0.350 % | -0.343 % |
| V008b Spencer | 1.366 | 1.3647 | 1.3648 | -0.095 % | -0.088 % |
| V019 Spencer (40 slices, vertical pore-pressure head) | 1.389 | 1.3985 | 1.3986 | +0.684 % | +0.691 % |
| V004a Spencer | 2.794 | 2.8019 | 2.8021 | +0.283 % | +0.290 % |
| V031b Bishop simplified | 1.398 | 1.3894 | 1.3893 | -0.615 % | -0.622 % |
| V019 Bishop simplified | 1.401 | 1.4010 | 1.4011 | 0.000 % | +0.007 % |
| V030 Bishop simplified | 1.412 | 1.4083 | 1.4082 | -0.262 % | -0.269 % |
| V001 Morgenstern-Price (half-sine) | 1.414 | 1.4010 | 1.4011 | -0.919 % | -0.912 % |
| V040 Bishop simplified, circles only | 1.461 | 1.4593 | 1.4594 | -0.116 % | -0.110 % |
| V104c Bishop simplified | 1.470 | 1.4619 | 1.4618 | -0.551 % | -0.558 % |
| V060b Bishop simplified | 2.973 | 2.9743 | 2.9745 | +0.044 % | +0.050 % |
| V082b Spencer | 1.510 | 1.5118 | 1.5119 | +0.119 % | +0.126 % |
| V082a Spencer | 1.532 | 1.5331 | 1.5332 | +0.072 % | +0.078 % |
| V082a Morgenstern-Price (half-sine) | 1.532 | 1.5331 | 1.5332 | +0.072 % | +0.078 % |
| V008a Spencer | 1.536 | 1.5188 | 1.5189 | -1.120 % | -1.113 % |
| V048 Spencer | 1.592 | 1.5824 | 1.5825 | -0.603 % | -0.597 % |
| V048 Bishop simplified | 1.596 | 1.5869 | 1.5868 | -0.570 % | -0.576 % |
| V037 Spencer | 1.620 | 1.6073 | 1.6074 | -0.784 % | -0.778 % |
| V085 Janbu simplified | 1.628 | 1.6268 | 1.6267 | -0.074 % | -0.080 % |
| V037 Bishop simplified | 1.629 | 1.6134 | 1.6135 | -0.958 % | -0.952 % |
| V042 Spencer | 1.648 | 1.6492 | 1.6493 | +0.073 % | +0.079 % |
| V047b Bishop simplified | 1.664 | 1.6591 | 1.6592 | -0.294 % | -0.288 % |
| V085 Janbu corrected | 1.736 | 1.7351 | 1.7350 | -0.052 % | -0.058 % |
| V016a Bishop simplified | 1.788 | 1.7905 | 1.7904 | +0.112 % | +0.106 % |
| V016a Spencer | 1.791 | 1.7975 | 1.7974 | +0.363 % | +0.357 % |
| V052b Janbu corrected | 2.073 | 2.0728 | 2.0729 | -0.010 % | -0.005 % |
| V052b Morgenstern-Price (half-sine) | 2.299 | 2.2994 | 2.2993 | +0.017 % | +0.013 % |
| V031a Spencer | 2.545 | 2.5306 | 2.5307 | -0.566 % | -0.562 % |
| V062a Bishop simplified | 2.556 | 2.5485 | 2.5486 | -0.274 % | -0.270 % |
| V062d Bishop simplified | 2.586 | 2.5769 | 2.5768 | -0.352 % | -0.356 % |
| V062e Bishop simplified | 2.697 | 2.6902 | 2.6901 | -0.271 % | -0.274 % |
| **Mean error (n = 301)** | | | | -0.228 % | -0.217 % |
| **Mean absolute error** | | | | 0.323 % | 0.317 % |
| **RMS error** | | | | 0.455 % | 0.449 % |
| **Largest error** | | | | 2.109 % | 2.036 % |

**Against the papers:** 76 moved (40 closer to the reference, 36 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V041a Spencer (Duncan & Wright) | 1.600 | 1.5937 | 1.5957 | -0.394 % | -0.269 % |
| V041b Spencer (Duncan & Wright) | 1.600 | 1.5931 | 1.5951 | -0.431 % | -0.306 % |
| V068 Bishop simplified (Low) | 1.140 | 1.1429 | 1.1423 | +0.254 % | +0.202 % |
| V038b Spencer (Duncan & Wright) | 1.160 | 1.1569 | 1.1575 | -0.267 % | -0.216 % |
| V038b Spencer, finite-element pore pressures (Duncan, Wright & Brandon (2014)) | 1.190 | 1.1569 | 1.1575 | -2.782 % | -2.731 % |
| V036c Spencer (Duncan & Wright) | 1.030 | 1.0286 | 1.0281 | -0.136 % | -0.184 % |
| V058 finite elements (Griffiths & Lane) | 1.900 | 1.9152 | 1.9161 | +0.800 % | +0.847 % |
| V036b Spencer (Duncan & Wright) | 0.900 | 0.8982 | 0.8978 | -0.200 % | -0.244 % |
| V036a Spencer (Duncan & Wright) | 0.750 | 0.7521 | 0.7518 | +0.280 % | +0.240 % |
| V021d Bishop simplified (Chowdhury & Xu) | 1.064 | 1.0580 | 1.0584 | -0.555 % | -0.517 % |
| V021b Bishop simplified (Chowdhury & Xu) | 1.109 | 1.1098 | 1.1102 | +0.090 % | +0.126 % |
| V028 Spencer (Duncan & Wright) | 1.124 | 1.1230 | 1.1234 | -0.089 % | -0.053 % |
| V070 stability chart (Morgenstern) | 1.410 | 1.4147 | 1.4152 | +0.333 % | +0.369 % |
| V036d Spencer (Duncan & Wright) | 1.130 | 1.1315 | 1.1311 | +0.133 % | +0.097 % |
| V003 Bishop simplified (Arai & Tagyo (1985)) | 1.138 | 1.1130 | 1.1134 | -2.197 % | -2.162 % |
| V021g Bishop simplified (Chowdhury & Xu) | 1.424 | 1.4279 | 1.4284 | +0.281 % | +0.316 % |
| V057a limit-equilibrium chart (Griffiths & Lane) | 1.460 | 1.4721 | 1.4726 | +0.829 % | +0.863 % |
| V039 Spencer, composite circle, composite surface (Duncan & Wright) | 1.170 | 1.1659 | 1.1663 | -0.350 % | -0.316 % |
| V069a stability chart (Morgenstern) | 1.200 | 1.1999 | 1.2003 | -0.008 % | +0.025 % |
| V021f Bishop simplified (Chowdhury & Xu) | 2.140 | 2.1281 | 2.1288 | -0.537 % | -0.505 % |
| V021e Bishop simplified (Chowdhury & Xu) | 2.234 | 2.2449 | 2.2456 | +0.474 % | +0.506 % |
| V065 Bishop simplified, deep circle (read from fig. 7a) (Leshchinsky & Han (2004)) | 0.980 | 0.9772 | 0.9769 | -0.286 % | -0.316 % |
| V065 Bishop simplified, circular (Leshchinsky & Han (2004)) | 1.000 | 0.9772 | 0.9769 | -2.280 % | -2.310 % |
| V021c Bishop simplified (Chowdhury & Xu) | 1.110 | 1.1084 | 1.1087 | -0.108 % | -0.081 % |
| V021a Bishop simplified (Chowdhury & Xu) | 1.118 | 1.1283 | 1.1286 | +0.939 % | +0.966 % |
| V027 Spencer (Duncan & Wright) | 1.124 | 1.1345 | 1.1348 | +0.934 % | +0.961 % |
| V089 Bishop simplified (USACE EM 1110-2-1902) | 2.710 | 2.6982 | 2.6989 | -0.435 % | -0.410 % |
| V096e Morgenstern-Price (half-sine) (Zhu & Lee) | 1.197 | 1.1969 | 1.1972 | -0.008 % | +0.017 % |
| V034a Spencer (Duncan & Wright) | 1.276 | 1.2762 | 1.2759 | +0.016 % | -0.008 % |
| V093 Bishop simplified (Yamagami & Ueta (1988)) | 1.348 | 1.3427 | 1.3430 | -0.393 % | -0.371 % |
| V045 Spencer (Fredlund & Krahn) | 1.830 | 1.8275 | 1.8279 | -0.137 % | -0.115 % |
| V045 Morgenstern-Price (half-sine) (Fredlund & Krahn) | 1.832 | 1.8267 | 1.8271 | -0.289 % | -0.267 % |
| V045 Bishop simplified (Fredlund & Krahn) | 1.834 | 1.8290 | 1.8294 | -0.273 % | -0.251 % |
| V055 finite elements (Griffiths & Lane) | 1.400 | 1.3662 | 1.3665 | -2.414 % | -2.393 % |
| V005 infinite slope (Theory) | 2.500 | 2.5126 | 2.5121 | +0.504 % | +0.484 % |
| V033 Spencer (Duncan & Wright) | 1.529 | 1.5328 | 1.5331 | +0.249 % | +0.268 % |
| V024 Bishop simplified (Duncan & Wright) | 1.570 | 1.5718 | 1.5721 | +0.115 % | +0.134 % |
| V053 Spencer, local minimum (nearly circular surface from the toe) (Greco (1996)) | 1.080 | 1.0913 | 1.0915 | +1.046 % | +1.065 % |
| V054 Spencer, local minimum (nearly circular surface from the toe) (Greco (1996)) | 1.080 | 1.0913 | 1.0915 | +1.046 % | +1.065 % |
| V029 Spencer (Duncan & Wright) | 1.119 | 1.1183 | 1.1185 | -0.063 % | -0.045 % |
| V010b Bishop simplified (Borges & Cardoso) | 1.150 | 1.1588 | 1.1586 | +0.765 % | +0.748 % |
| V044b Spencer (Fredlund & Krahn) | 1.761 | 1.7576 | 1.7579 | -0.193 % | -0.176 % |
| V044b Morgenstern-Price (half-sine) (Fredlund & Krahn) | 1.764 | 1.7569 | 1.7572 | -0.402 % | -0.385 % |
| V096e Spencer (Zhu & Lee) | 1.211 | 1.2120 | 1.2122 | +0.083 % | +0.099 % |
| V086c Spencer (Tandjiria, Low & Teh (2002)) | 1.219 | 1.2064 | 1.2062 | -1.034 % | -1.050 % |
| V088 Spencer (USACE EM 1110-2-1902) | 2.440 | 2.4416 | 2.4420 | +0.066 % | +0.082 % |
| V034b Spencer (Duncan & Wright) | 1.328 | 1.3280 | 1.3278 | 0.000 % | -0.015 % |
| V044 Spencer (Fredlund & Krahn) | 2.073 | 2.0721 | 2.0724 | -0.043 % | -0.029 % |
| V001 Bishop simplified (Arai & Tagyo (1985)) | 1.451 | 1.4041 | 1.4043 | -3.232 % | -3.218 % |
| V005 Spencer, non-circular (dynamic programming) (Baker, Frydman & Talesnick (1993)) | 2.410 | 2.5043 | 2.5046 | +3.913 % | +3.925 % |
| V044b Bishop simplified (Fredlund & Krahn) | 1.766 | 1.7595 | 1.7597 | -0.368 % | -0.357 % |
| V065 Spencer, three-part wedge (Leshchinsky & Han (2004)) | 0.920 | 0.9585 | 0.9584 | +4.185 % | +4.174 % |
| V086b Spencer (Tandjiria, Low & Teh (2002)) | 0.981 | 0.9683 | 0.9684 | -1.295 % | -1.284 % |
| V086d Spencer (Tandjiria, Low & Teh) | 0.981 | 0.9730 | 0.9731 | -0.815 % | -0.805 % |
| V066a Bishop simplified, circular (Leshchinsky & Han (2004)) | 1.000 | 1.0305 | 1.0306 | +3.050 % | +3.060 % |
| V102a Spencer (Loukidis, Bandini & Salgado) | 1.000 | 1.0009 | 1.0010 | +0.090 % | +0.100 % |
| V102b Spencer (Loukidis, Bandini & Salgado) | 1.000 | 1.0006 | 1.0007 | +0.060 % | +0.070 % |
| V044 Morgenstern-Price (half-sine) (Fredlund & Krahn) | 2.076 | 2.0717 | 2.0719 | -0.207 % | -0.197 % |
| V044 Bishop simplified (Fredlund & Krahn) | 2.080 | 2.0760 | 2.0762 | -0.192 % | -0.183 % |
| V003 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 1.071 | 1.0469 | 1.0470 | -2.250 % | -2.241 % |
| V013a Bishop simplified (Cai & Ugai) | 1.130 | 1.1429 | 1.1430 | +1.142 % | +1.150 % |
| V022a Bishop simplified (Chowdhury & Xu) | 1.163 | 1.1586 | 1.1587 | -0.335 % | -0.327 % |
| V063 Bishop simplified (Huang & Jia) | 2.430 | 2.4528 | 2.4530 | +0.938 % | +0.947 % |
| V026 Bishop simplified (Duncan & Wright) | 1.220 | 1.2198 | 1.2197 | -0.016 % | -0.025 % |
| V035b Bishop simplified (Duncan & Wright) | 1.320 | 1.3206 | 1.3207 | +0.045 % | +0.053 % |
| V020 Spencer (Cheng et al.) | 1.330 | 1.3329 | 1.3330 | +0.218 % | +0.226 % |
| V101 Bishop simplified (Hassan & Wolff) | 1.334 | 1.3337 | 1.3338 | -0.022 % | -0.015 % |
| V019 Spencer (Cheng et al.) | 1.383 | 1.3985 | 1.3986 | +1.121 % | +1.128 % |
| V030 Spencer (Duncan & Wright) | 1.400 | 1.3989 | 1.3988 | -0.079 % | -0.086 % |
| V039 Spencer (Duncan & Wright) | 1.450 | 1.4472 | 1.4473 | -0.193 % | -0.186 % |
| V040 Bishop simplified (El-Ramly et al. (2002)) | 1.460 | 1.4593 | 1.4594 | -0.048 % | -0.041 % |
| V037 Spencer (Duncan, Wright & Brandon (2014)) | 1.620 | 1.6073 | 1.6074 | -0.784 % | -0.778 % |
| V085 Janbu simplified (Duncan & Wright) | 1.630 | 1.6268 | 1.6267 | -0.196 % | -0.202 % |
| V096d Morgenstern-Price (half-sine) (Zhu & Lee) | 1.823 | 1.8084 | 1.8083 | -0.801 % | -0.806 % |
| V096d Spencer (Zhu & Lee) | 1.836 | 1.8239 | 1.8238 | -0.659 % | -0.664 % |
| V031a Spencer (Duncan & Wright) | 2.560 | 2.5306 | 2.5307 | -1.148 % | -1.145 % |
| **Mean error (n = 123)** | | | | -0.164 % | -0.156 % |
| **Mean absolute error** | | | | 0.938 % | 0.936 % |
| **RMS error** | | | | 1.521 % | 1.520 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-10: Rust engine: faster slice builder and solvers (precomputed slice invariants, shared iteration), dead code and duplicates removed, workspace lints

Compared with 8bbfb390. Errors are relative to the reference, in percent. Verification run time: 496 s (4 workers, load 1.4 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-07: Web: Download .cslp (project writer in a separate WebAssembly module)

Compared with 8e9967c3. Errors are relative to the reference, in percent. Verification run time: 542 s (4 workers, load 0.8 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-07: Engine: warning when the critical surface lies on the edge of the search limits

Compared with d6376020. Errors are relative to the reference, in percent. Verification run time: 533 s (4 workers, load 1.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-07: Engine: the same bits on every platform (libm crate); Python 3.10 minimum

Compared with 169a117a. Errors are relative to the reference, in percent. Verification run time: 529 s (4 workers, load 0.6 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-07: Engine: shallow-slide warning says design φ′ only on design values (#106)

Compared with 049777ad. Errors are relative to the reference, in percent. Verification run time: 520 s (4 workers, load 1.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-07: Engine: boundary ends past, on or just inside the outline split the regions (#93)

Compared with f81c22c1. Errors are relative to the reference, in percent. Verification run time: 517 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-06: cslope-project conversion (#57) and Monte Carlo message (#81)

Compared with 54a27605. Errors are relative to the reference, in percent. Verification run time: 484 s (4 workers, load 2.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-06: Schema, validation and result summary (#55)

Compared with 7e0f3f3f. Errors are relative to the reference, in percent. Verification run time: 501 s (4 workers, load 1.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-06: Engine TS cleanup (#51): no result should move

Compared with f061edbf. Errors are relative to the reference, in percent. Verification run time: 546 s (4 workers, load 3.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-05: A nearly vertical model side is not ground: no slip surface through it

Compared with 8d215f56. Errors are relative to the reference, in percent. Verification run time: 194 s (4 workers, load 2.4 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-05: Verification texts in American spelling (no engine change)

Compared with c8ed2c4. Errors are relative to the reference, in percent. Verification run time: 543 s (4 workers, load 0.6 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.228 % | -0.228 % |
| **Mean absolute error** | | | | 0.323 % | 0.323 % |
| **RMS error** | | | | 0.455 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.164 % | -0.164 % |
| **Mean absolute error** | | | | 0.938 % | 0.938 % |
| **RMS error** | | | | 1.521 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-04: Minimum slip area defaults to 0 (no limit); slice shear force and FE progress from the engine

Compared with 5c6f310. Errors are relative to the reference, in percent. Verification run time: 503 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 5 moved (5 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V052a Janbu corrected | 1.949 | 1.9741 | 1.9508 | +1.288 % | +0.092 % |
| V052a Spencer | 1.948 | 1.9636 | 1.9478 | +0.801 % | -0.010 % |
| V052a Bishop simplified | 1.950 | 1.9636 | 1.9479 | +0.723 % | -0.082 % |
| V032b Bishop simplified | 1.155 | 1.1558 | 1.1548 | +0.069 % | -0.017 % |
| V032b Spencer | 1.155 | 1.1556 | 1.1547 | +0.052 % | -0.026 % |
| **Mean error (n = 301)** | | | | -0.218 % | -0.228 % |
| **Mean absolute error** | | | | 0.332 % | 0.323 % |
| **RMS error** | | | | 0.465 % | 0.455 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 3 moved (2 closer to the reference, 1 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V005 infinite slope (Theory) | 2.500 | 2.5237 | 2.5126 | +0.948 % | +0.504 % |
| V032b Spencer (Duncan & Wright) | 1.150 | 1.1556 | 1.1547 | +0.487 % | +0.409 % |
| V005 Spencer, non-circular (dynamic programming) (Baker, Frydman & Talesnick (1993)) | 2.410 | 2.5035 | 2.5043 | +3.880 % | +3.913 % |
| **Mean error (n = 123)** | | | | -0.160 % | -0.164 % |
| **Mean absolute error** | | | | 0.942 % | 0.938 % |
| **RMS error** | | | | 1.522 % | 1.521 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.288 % | -0.288 % |
| **Mean absolute error** | | | | 2.026 % | 2.026 % |
| **RMS error** | | | | 2.735 % | 2.735 % |
| **Largest error** | | | | 6.325 % | 6.325 % |


### 2026-11-04: V056: Griffiths & Lane's coarse-mesh finite element value disputed, not counted; slice shear force reported by the engine

Compared with b706da8. Errors are relative to the reference, in percent. Verification run time: 554 s (4 workers, load 0.9 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.218 % | -0.218 % |
| **Mean absolute error** | | | | 0.332 % | 0.332 % |
| **RMS error** | | | | 0.465 % | 0.465 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.160 % | -0.160 % |
| **Mean absolute error** | | | | 0.942 % | 0.942 % |
| **RMS error** | | | | 1.522 % | 1.522 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 34)** | | | | -0.711 % | -0.288 % |
| **Mean absolute error** | | | | 2.399 % | 2.026 % |
| **RMS error** | | | | 3.712 % | 2.735 % |
| **Largest error** | | | | 15.100 % | 6.325 % |


### 2026-11-04: Engine rewritten in Rust (WebAssembly); TypeScript engine removed

Compared with 573d84e. Errors are relative to the reference, in percent. Verification run time: 575 s (4 workers, load 2.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.218 % | -0.218 % |
| **Mean absolute error** | | | | 0.332 % | 0.332 % |
| **RMS error** | | | | 0.465 % | 0.465 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.160 % | -0.160 % |
| **Mean absolute error** | | | | 0.942 % | 0.942 % |
| **RMS error** | | | | 1.522 % | 1.522 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-04: Morgenstern-Price: a converged solution needs positive Fm and Ff and a gap below a capped tolerance

Compared with 021b3cb. Errors are relative to the reference, in percent. Verification run time: 2341 s (4 workers, load 13.9 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.218 % | -0.218 % |
| **Mean absolute error** | | | | 0.332 % | 0.332 % |
| **RMS error** | | | | 0.465 % | 0.465 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.160 % | -0.160 % |
| **Mean absolute error** | | | | 0.942 % | 0.942 % |
| **RMS error** | | | | 1.522 % | 1.522 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-03: Parallel evaluation of trial surfaces (searches as steps, evaluator pool); sequential path unchanged

Compared with 11b3a0e. Errors are relative to the reference, in percent. Verification run time: 803 s (4 workers, load 1.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.218 % | -0.218 % |
| **Mean absolute error** | | | | 0.332 % | 0.332 % |
| **RMS error** | | | | 0.465 % | 0.465 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.160 % | -0.160 % |
| **Mean absolute error** | | | | 0.942 % | 0.942 % |
| **RMS error** | | | | 1.522 % | 1.522 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-03: Verification problems for B̄, SHANSEP with an earlier stage and head lines (V104, V105)

Compared with 52c9a68. Errors are relative to the reference, in percent. Verification run time: 537 s (4 workers, load 4.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 301)** | | | | -0.221 % | -0.218 % |
| **Mean absolute error** | | | | 0.336 % | 0.332 % |
| **RMS error** | | | | 0.469 % | 0.465 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.160 % | -0.160 % |
| **Mean absolute error** | | | | 0.942 % | 0.942 % |
| **RMS error** | | | | 1.522 % | 1.522 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-03: Verification problems with the pore pressure ratio ru (Fredlund & Krahn cases 3 and 4, Li & Lumb, Loukidis et al., Spencer, Jiang et al.)

Compared with b8f9630. Errors are relative to the reference, in percent. Verification run time: 110 s (4 workers, load 0.8 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 293)** | | | | -0.222 % | -0.221 % |
| **Mean absolute error** | | | | 0.342 % | 0.336 % |
| **RMS error** | | | | 0.476 % | 0.469 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 123)** | | | | -0.155 % | -0.160 % |
| **Mean absolute error** | | | | 1.003 % | 0.942 % |
| **RMS error** | | | | 1.589 % | 1.522 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-03: Pore pressure ratio ru

Compared with 9ff3a08. Errors are relative to the reference, in percent. Verification run time: 489 s (4 workers, load 5.4 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 281)** | | | | -0.222 % | -0.222 % |
| **Mean absolute error** | | | | 0.342 % | 0.342 % |
| **RMS error** | | | | 0.476 % | 0.476 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 112)** | | | | -0.155 % | -0.155 % |
| **Mean absolute error** | | | | 1.003 % | 1.003 % |
| **RMS error** | | | | 1.589 % | 1.589 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-03: Import and export of .stix and .sli/.slim/.slmd files; waternet, strength above the water line, POP/yield stress with an earlier stage, load consolidation

Compared with 1daf4d7. Errors are relative to the reference, in percent. Verification run time: 498 s (4 workers, load 2.8 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 281)** | | | | -0.222 % | -0.222 % |
| **Mean absolute error** | | | | 0.342 % | 0.342 % |
| **RMS error** | | | | 0.476 % | 0.476 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 112)** | | | | -0.155 % | -0.155 % |
| **Mean absolute error** | | | | 1.003 % | 1.003 % |
| **RMS error** | | | | 1.589 % | 1.589 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-03: Reinforcement, SHANSEP, B-bar, shear-normal, seismic, inclined line loads, rapid drawdown; composite review fixes

Compared with 0206bc8. Errors are relative to the reference, in percent. Verification run time: 210 s (4 workers, load 0.7 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 281)** | | | | -0.222 % | -0.222 % |
| **Mean absolute error** | | | | 0.342 % | 0.342 % |
| **RMS error** | | | | 0.476 % | 0.476 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 112)** | | | | -0.155 % | -0.155 % |
| **Mean absolute error** | | | | 1.003 % | 1.003 % |
| **RMS error** | | | | 1.589 % | 1.589 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-03: Composite circles along bedrock (default on); along the model base optional (compositeBase)

Compared with 7e37a28. Errors are relative to the reference, in percent. Verification run time: 719 s (4 workers, load 3.7 at start).

**Against other programs (midpoint of their range):** 2 moved (2 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V073 Spencer | 1.400 | 1.4146 | 1.3952 | -0.520 % | -0.343 % |
| V073 Bishop simplified | 1.392 | 1.4100 | 1.3873 | -0.494 % | -0.338 % |
| **Mean error (n = 281)** | | | | -0.221 % | -0.222 % |
| **Mean absolute error** | | | | 0.342 % | 0.342 % |
| **RMS error** | | | | 0.477 % | 0.476 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 112)** | | | | -0.153 % | -0.155 % |
| **Mean absolute error** | | | | 1.009 % | 1.003 % |
| **RMS error** | | | | 1.596 % | 1.589 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-02: Exit range starting at the toe moved upslope; Hoek-Brown mb, s, a given directly

Compared with f6c8c8c. Errors are relative to the reference, in percent. Verification run time: 779 s (4 workers, load 1.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.221 % | -0.221 % |
| **Mean absolute error** | | | | 0.342 % | 0.342 % |
| **RMS error** | | | | 0.477 % | 0.477 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 1 moved (0 closer to the reference, 1 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V005 Spencer, non-circular (dynamic programming) (Baker, Frydman & Talesnick (1993)) | 2.410 | 2.5023 | 2.5035 | +3.830 % | +3.880 % |
| **Mean error (n = 111)** | | | | -0.154 % | -0.153 % |
| **Mean absolute error** | | | | 1.009 % | 1.009 % |
| **RMS error** | | | | 1.595 % | 1.596 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-02: Search ranges given as a point; .gsz tension crack angle and water

Compared with d7dd251. Errors are relative to the reference, in percent. Verification run time: 730 s (4 workers, load 1.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.221 % | -0.221 % |
| **Mean absolute error** | | | | 0.342 % | 0.342 % |
| **RMS error** | | | | 0.477 % | 0.477 % |
| **Largest error** | | | | 2.109 % | 2.109 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.154 % | -0.154 % |
| **Mean absolute error** | | | | 1.009 % | 1.009 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-02: Arc-consistent slice base on circles, steep ends cut

Compared with ff7ebcf. Errors are relative to the reference, in percent. Verification run time: 753 s (4 workers, load 1.7 at start).

**Against other programs (midpoint of their range):** 129 moved (85 closer to the reference, 44 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V091 Janbu corrected | 1.385 | 1.3802 | 1.3904 | -0.347 % | +0.390 % |
| V003 Janbu corrected | 1.131 | 1.1244 | 1.1290 | -0.584 % | -0.177 % |
| V028 Bishop simplified | 1.126 | 1.1219 | 1.1235 | -0.364 % | -0.222 % |
| V091 Bishop simplified | 1.241 | 1.2348 | 1.2364 | -0.500 % | -0.371 % |
| V091 Spencer | 1.241 | 1.2349 | 1.2364 | -0.492 % | -0.371 % |
| V091 Morgenstern-Price (half-sine) | 1.244 | 1.2349 | 1.2364 | -0.732 % | -0.611 % |
| V029 Bishop simplified | 1.125 | 1.1170 | 1.1183 | -0.711 % | -0.596 % |
| V057a Spencer | 1.468 | 1.4705 | 1.4721 | +0.170 % | +0.279 % |
| V071b Janbu simplified | 1.151 | 1.1467 | 1.1478 | -0.374 % | -0.278 % |
| V035b Bishop simplified | 1.324 | 1.3194 | 1.3206 | -0.347 % | -0.257 % |
| V065 Spencer | 0.964 | 0.9591 | 0.9585 | -0.508 % | -0.571 % |
| V007a Janbu simplified | 1.469 | 1.4676 | 1.4683 | -0.095 % | -0.048 % |
| V027 Bishop simplified | 1.126 | 1.1225 | 1.1230 | -0.311 % | -0.266 % |
| V011a Bishop simplified | 1.230 | 1.2193 | 1.2198 | -0.870 % | -0.829 % |
| V036a Bishop simplified | 0.761 | 0.7565 | 0.7568 | -0.591 % | -0.552 % |
| V096b Morgenstern-Price (half-sine) | 1.174 | 1.1716 | 1.1720 | -0.204 % | -0.170 % |
| V034b Spencer, non-circular | 1.182 | 1.1682 | 1.1686 | -1.168 % | -1.134 % |
| V035a Morgenstern-Price (half-sine) | 1.575 | 1.5677 | 1.5682 | -0.463 % | -0.432 % |
| V007c Janbu simplified | 1.291 | 1.2897 | 1.2901 | -0.101 % | -0.070 % |
| V012 Bishop simplified | 0.980 | 0.9815 | 0.9818 | +0.153 % | +0.184 % |
| V034b Bishop simplified | 1.335 | 1.3295 | 1.3299 | -0.412 % | -0.382 % |
| V092 Janbu corrected | 1.830 | 1.8237 | 1.8232 | -0.344 % | -0.372 % |
| V003 Spencer | 1.118 | 1.1135 | 1.1138 | -0.403 % | -0.376 % |
| V036a Spencer | 0.756 | 0.7519 | 0.7521 | -0.542 % | -0.516 % |
| V076 Spencer | 1.145 | 1.1403 | 1.1406 | -0.410 % | -0.384 % |
| V076 Bishop simplified | 1.147 | 1.1424 | 1.1427 | -0.401 % | -0.375 % |
| V010 Bishop simplified | 1.170 | 1.1637 | 1.1640 | -0.538 % | -0.513 % |
| V010 Morgenstern-Price (half-sine) | 1.171 | 1.1624 | 1.1627 | -0.734 % | -0.709 % |
| V096b Bishop simplified | 1.176 | 1.1731 | 1.1734 | -0.247 % | -0.221 % |
| V096b Spencer | 1.189 | 1.1865 | 1.1868 | -0.210 % | -0.185 % |
| V041b Spencer | 1.599 | 1.5935 | 1.5931 | -0.344 % | -0.369 % |
| V011b Bishop simplified | 1.220 | 1.2164 | 1.2167 | -0.295 % | -0.270 % |
| V002 Bishop simplified | 0.420 | 0.4192 | 0.4193 | -0.190 % | -0.167 % |
| V096a Morgenstern-Price (half-sine) | 1.790 | 1.7796 | 1.7800 | -0.581 % | -0.559 % |
| V036b Spencer | 0.898 | 0.8980 | 0.8982 | 0.000 % | +0.022 % |
| V049 Janbu corrected | 1.357 | 1.3553 | 1.3550 | -0.125 % | -0.147 % |
| V036b Bishop simplified | 0.909 | 0.9057 | 0.9059 | -0.363 % | -0.341 % |
| V086b Spencer (2 m tension crack) | 0.975 | 0.9681 | 0.9683 | -0.708 % | -0.687 % |
| V086b Morgenstern-Price (half-sine) | 0.975 | 0.9681 | 0.9683 | -0.708 % | -0.687 % |
| V086b Spencer (tension crack of automatic depth) | 0.975 | 0.9663 | 0.9665 | -0.892 % | -0.872 % |
| V041a Spencer | 1.599 | 1.5940 | 1.5937 | -0.313 % | -0.331 % |
| V041b Bishop simplified | 1.603 | 1.5967 | 1.5964 | -0.393 % | -0.412 % |
| V041a Bishop simplified | 1.603 | 1.5969 | 1.5966 | -0.381 % | -0.399 % |
| V003 Bishop simplified | 1.115 | 1.1128 | 1.1130 | -0.197 % | -0.179 % |
| V022b Morgenstern-Price (half-sine) | 1.178 | 1.1744 | 1.1746 | -0.306 % | -0.289 % |
| V096c Spencer | 1.804 | 1.7994 | 1.7997 | -0.255 % | -0.238 % |
| V096a Spencer | 1.804 | 1.7941 | 1.7944 | -0.549 % | -0.532 % |
| V089 Janbu corrected | 2.650 | 2.6477 | 2.6473 | -0.087 % | -0.102 % |
| V086a Spencer | 1.341 | 1.3328 | 1.3330 | -0.611 % | -0.597 % |
| V048 Janbu corrected | 1.489 | 1.4750 | 1.4748 | -0.940 % | -0.954 % |
| V062e Bishop simplified | 2.697 | 2.6899 | 2.6902 | -0.282 % | -0.271 % |
| V096a Bishop simplified | 1.804 | 1.7933 | 1.7935 | -0.593 % | -0.582 % |
| V096c Bishop simplified | 1.804 | 1.7990 | 1.7992 | -0.277 % | -0.266 % |
| V047a Janbu corrected | 0.990 | 0.9856 | 0.9855 | -0.444 % | -0.455 % |
| V036c Spencer, non-circular | 1.018 | 1.0165 | 1.0166 | -0.147 % | -0.138 % |
| V036c Spencer | 1.032 | 1.0285 | 1.0286 | -0.339 % | -0.329 % |
| V052b Janbu corrected | 2.073 | 2.0730 | 2.0728 | 0.000 % | -0.010 % |
| V036c Bishop simplified | 1.045 | 1.0424 | 1.0425 | -0.249 % | -0.239 % |
| V038 Bishop simplified | 1.080 | 1.0695 | 1.0694 | -0.972 % | -0.981 % |
| V054 Bishop simplified | 1.087 | 1.0855 | 1.0856 | -0.138 % | -0.129 % |
| V038 Spencer | 1.100 | 1.0769 | 1.0768 | -2.100 % | -2.109 % |
| V021c Bishop simplified | 1.108 | 1.1083 | 1.1084 | +0.027 % | +0.036 % |
| V021c Morgenstern-Price (half-sine) | 1.110 | 1.1083 | 1.1084 | -0.153 % | -0.144 % |
| V036d Spencer, non-circular | 1.116 | 1.1192 | 1.1193 | +0.287 % | +0.296 % |
| V021a Bishop simplified (60 slices) | 1.128 | 1.1282 | 1.1283 | +0.018 % | +0.027 % |
| V021a Morgenstern-Price (half-sine) | 1.132 | 1.1282 | 1.1283 | -0.336 % | -0.327 % |
| V036d Spencer | 1.134 | 1.1316 | 1.1315 | -0.212 % | -0.220 % |
| V072b Janbu simplified | 1.141 | 1.1351 | 1.1352 | -0.517 % | -0.508 % |
| V036d Bishop simplified | 1.154 | 1.1520 | 1.1521 | -0.173 % | -0.165 % |
| V022a Bishop simplified (60 slices) | 1.160 | 1.1585 | 1.1586 | -0.129 % | -0.121 % |
| V022b Bishop simplified | 1.185 | 1.1772 | 1.1773 | -0.658 % | -0.650 % |
| V086c Spencer | 1.209 | 1.2063 | 1.2064 | -0.223 % | -0.215 % |
| V088 Janbu corrected | 2.430 | 2.4440 | 2.4438 | +0.576 % | +0.568 % |
| V086c Morgenstern-Price (half-sine) | 1.218 | 1.2150 | 1.2151 | -0.246 % | -0.238 % |
| V032a Bishop simplified | 1.230 | 1.2239 | 1.2240 | -0.496 % | -0.488 % |
| V034a Spencer, non-circular | 1.262 | 1.2601 | 1.2600 | -0.151 % | -0.158 % |
| V090 Morgenstern-Price (half-sine) | 1.327 | 1.3163 | 1.3164 | -0.806 % | -0.799 % |
| V004a Janbu simplified | 2.662 | 2.6767 | 2.6765 | +0.552 % | +0.545 % |
| V090 Bishop simplified | 1.332 | 1.3204 | 1.3205 | -0.871 % | -0.863 % |
| V020 Spencer | 1.337 | 1.3328 | 1.3329 | -0.314 % | -0.307 % |
| V082d Janbu corrected | 1.345 | 1.3430 | 1.3429 | -0.149 % | -0.156 % |
| V090 Janbu corrected | 1.345 | 1.3406 | 1.3405 | -0.327 % | -0.335 % |
| V098 Spencer, non-circular | 1.360 | 1.3567 | 1.3568 | -0.243 % | -0.235 % |
| V008b Spencer | 1.366 | 1.3646 | 1.3647 | -0.102 % | -0.095 % |
| V098 Spencer | 1.372 | 1.3722 | 1.3721 | +0.015 % | +0.007 % |
| V017a Bishop simplified | 1.373 | 1.3823 | 1.3822 | +0.677 % | +0.670 % |
| V049 Spencer | 1.375 | 1.3722 | 1.3721 | -0.204 % | -0.211 % |
| V017b Bishop simplified | 1.378 | 1.3823 | 1.3822 | +0.312 % | +0.305 % |
| V082d Morgenstern-Price (half-sine) | 1.378 | 1.3709 | 1.3710 | -0.515 % | -0.508 % |
| V049 Morgenstern-Price (half-sine) | 1.382 | 1.3717 | 1.3716 | -0.745 % | -0.753 % |
| V017a Spencer | 1.386 | 1.3983 | 1.3982 | +0.887 % | +0.880 % |
| V019 Spencer (40 slices, vertical pore-pressure head) | 1.389 | 1.3984 | 1.3985 | +0.677 % | +0.684 % |
| V082c Janbu corrected | 1.391 | 1.3918 | 1.3917 | +0.058 % | +0.050 % |
| V082c Bishop simplified | 1.396 | 1.3958 | 1.3959 | -0.014 % | -0.007 % |
| V019 Bishop simplified | 1.401 | 1.4009 | 1.4010 | -0.007 % | 0.000 % |
| V030 Bishop simplified | 1.412 | 1.4082 | 1.4083 | -0.269 % | -0.262 % |
| V001 Morgenstern-Price (half-sine) | 1.414 | 1.4009 | 1.4010 | -0.926 % | -0.919 % |
| V070 Spencer | 1.422 | 1.4209 | 1.4210 | -0.077 % | -0.070 % |
| V013c Bishop simplified | 1.430 | 1.4370 | 1.4371 | +0.490 % | +0.497 % |
| V067 Bishop simplified | 1.439 | 1.4358 | 1.4359 | -0.222 % | -0.215 % |
| V040 Bishop simplified | 1.461 | 1.4592 | 1.4593 | -0.123 % | -0.116 % |
| V081b Bishop simplified | 1.504 | 1.5011 | 1.5012 | -0.193 % | -0.186 % |
| V082a Morgenstern-Price (half-sine) | 1.532 | 1.5330 | 1.5331 | +0.065 % | +0.072 % |
| V008a Spencer | 1.536 | 1.5187 | 1.5188 | -1.126 % | -1.120 % |
| V013b Bishop simplified | 1.540 | 1.5407 | 1.5408 | +0.045 % | +0.052 % |
| V048 Bishop simplified | 1.596 | 1.5868 | 1.5869 | -0.576 % | -0.570 % |
| V042 Spencer | 1.648 | 1.6491 | 1.6492 | +0.067 % | +0.073 % |
| V047b Bishop simplified | 1.664 | 1.6590 | 1.6591 | -0.300 % | -0.294 % |
| V085 Janbu corrected | 1.736 | 1.7352 | 1.7351 | -0.046 % | -0.052 % |
| V016a Spencer | 1.791 | 1.7974 | 1.7975 | +0.357 % | +0.363 % |
| V016b Spencer | 1.839 | 1.8353 | 1.8354 | -0.201 % | -0.196 % |
| V092 Bishop simplified | 2.011 | 1.9905 | 1.9904 | -1.019 % | -1.024 % |
| V092 Spencer | 2.026 | 2.0047 | 2.0046 | -1.051 % | -1.056 % |
| V021f Bishop simplified | 2.128 | 2.1280 | 2.1281 | 0.000 % | +0.005 % |
| V021f Morgenstern-Price (half-sine) | 2.138 | 2.1280 | 2.1281 | -0.468 % | -0.463 % |
| V021e Bishop simplified | 2.245 | 2.2448 | 2.2449 | -0.009 % | -0.004 % |
| V021e Morgenstern-Price (half-sine) | 2.248 | 2.2448 | 2.2449 | -0.142 % | -0.138 % |
| V087 Janbu corrected | 2.290 | 2.2477 | 2.2476 | -1.847 % | -1.852 % |
| V052b Morgenstern-Price (half-sine) | 2.299 | 2.2993 | 2.2994 | +0.013 % | +0.017 % |
| V088 Bishop simplified | 2.447 | 2.4422 | 2.4423 | -0.196 % | -0.192 % |
| V031a Bishop simplified | 2.549 | 2.5337 | 2.5336 | -0.600 % | -0.604 % |
| V062a Bishop simplified | 2.556 | 2.5486 | 2.5485 | -0.270 % | -0.274 % |
| V004b Janbu simplified | 2.610 | 2.6090 | 2.6089 | -0.038 % | -0.042 % |
| V062f Bishop simplified | 2.673 | 2.6731 | 2.6732 | +0.022 % | +0.026 % |
| V062c Bishop simplified | 2.774 | 2.7791 | 2.7792 | +0.184 % | +0.187 % |
| V060b Bishop simplified | 2.973 | 2.9742 | 2.9743 | +0.040 % | +0.044 % |
| V062g Bishop simplified | 3.592 | 3.5917 | 3.5918 | -0.008 % | -0.006 % |
| V062h Bishop simplified | 6.072 | 6.0629 | 6.0630 | -0.142 % | -0.140 % |
| V062i Bishop simplified | 11.583 | 11.5666 | 11.5667 | -0.142 % | -0.141 % |
| **Mean error (n = 279)** | | | | -0.231 % | -0.221 % |
| **Mean absolute error** | | | | 0.348 % | 0.342 % |
| **RMS error** | | | | 0.483 % | 0.477 % |
| **Largest error** | | | | 2.100 % | 2.109 % |

**Against the papers:** 48 moved (31 closer to the reference, 17 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V068 Bishop simplified (Low) | 1.140 | 1.1342 | 1.1429 | -0.509 % | +0.254 % |
| V027 Spencer (Duncan & Wright) | 1.124 | 1.1323 | 1.1345 | +0.738 % | +0.934 % |
| V029 Spencer (Duncan & Wright) | 1.119 | 1.1170 | 1.1183 | -0.179 % | -0.063 % |
| V057a limit-equilibrium chart (Griffiths & Lane) | 1.460 | 1.4705 | 1.4721 | +0.719 % | +0.829 % |
| V028 Spencer (Duncan & Wright) | 1.124 | 1.1219 | 1.1230 | -0.187 % | -0.089 % |
| V035b Bishop simplified (Duncan & Wright) | 1.320 | 1.3194 | 1.3206 | -0.045 % | +0.045 % |
| V065 Spencer, three-part wedge (Leshchinsky & Han (2004)) | 0.920 | 0.9591 | 0.9585 | +4.250 % | +4.185 % |
| V065 Bishop simplified, deep circle (read from fig. 7a) (Leshchinsky & Han (2004)) | 0.980 | 0.9775 | 0.9772 | -0.255 % | -0.286 % |
| V034b Spencer (Duncan & Wright) | 1.328 | 1.3276 | 1.3280 | -0.030 % | 0.000 % |
| V065 Bishop simplified, circular (Leshchinsky & Han (2004)) | 1.000 | 0.9775 | 0.9772 | -2.250 % | -2.280 % |
| V036a Spencer (Duncan & Wright) | 0.750 | 0.7519 | 0.7521 | +0.253 % | +0.280 % |
| V010b Bishop simplified (Borges & Cardoso) | 1.150 | 1.1585 | 1.1588 | +0.739 % | +0.765 % |
| V041b Spencer (Duncan & Wright) | 1.600 | 1.5935 | 1.5931 | -0.406 % | -0.431 % |
| V002 Bishop simplified (Arai & Tagyo (1985)) | 0.417 | 0.4192 | 0.4193 | +0.528 % | +0.552 % |
| V002 Bishop simplified (Kim et al. (2002)) | 0.430 | 0.4192 | 0.4193 | -2.512 % | -2.488 % |
| V036b Spencer (Duncan & Wright) | 0.900 | 0.8980 | 0.8982 | -0.222 % | -0.200 % |
| V096d Morgenstern-Price (half-sine) (Zhu & Lee) | 1.823 | 1.8080 | 1.8084 | -0.823 % | -0.801 % |
| V086b Spencer (Tandjiria, Low & Teh (2002)) | 0.981 | 0.9681 | 0.9683 | -1.315 % | -1.295 % |
| V086d Spencer (Tandjiria, Low & Teh) | 0.981 | 0.9728 | 0.9730 | -0.836 % | -0.815 % |
| V003 Janbu simplified, non-circular (Arai & Tagyo (1985)) | 0.995 | 0.9661 | 0.9659 | -2.905 % | -2.925 % |
| V041a Spencer (Duncan & Wright) | 1.600 | 1.5940 | 1.5937 | -0.375 % | -0.394 % |
| V003 Bishop simplified (Arai & Tagyo (1985)) | 1.138 | 1.1128 | 1.1130 | -2.214 % | -2.197 % |
| V096e Morgenstern-Price (half-sine) (Zhu & Lee) | 1.197 | 1.1967 | 1.1969 | -0.025 % | -0.008 % |
| V096e Spencer (Zhu & Lee) | 1.211 | 1.2122 | 1.2120 | +0.099 % | +0.083 % |
| V096d Spencer (Zhu & Lee) | 1.836 | 1.8236 | 1.8239 | -0.675 % | -0.659 % |
| V030 Spencer (Duncan & Wright) | 1.400 | 1.3987 | 1.3989 | -0.093 % | -0.079 % |
| V036c Spencer (Duncan & Wright) | 1.030 | 1.0285 | 1.0286 | -0.146 % | -0.136 % |
| V003 Janbu corrected, non-circular (Arai & Tagyo (1985)) | 1.071 | 1.0470 | 1.0469 | -2.241 % | -2.250 % |
| V021c Bishop simplified (Chowdhury & Xu) | 1.110 | 1.1083 | 1.1084 | -0.117 % | -0.108 % |
| V021a Bishop simplified (Chowdhury & Xu) | 1.118 | 1.1282 | 1.1283 | +0.930 % | +0.939 % |
| V036d Spencer (Duncan & Wright) | 1.130 | 1.1316 | 1.1315 | +0.142 % | +0.133 % |
| V022b Bishop simplified (Chowdhury & Xu (1995)) | 1.148 | 1.1772 | 1.1773 | +2.552 % | +2.561 % |
| V022a Bishop simplified (Chowdhury & Xu) | 1.163 | 1.1585 | 1.1586 | -0.344 % | -0.335 % |
| V026 Spencer (Duncan & Wright) | 1.190 | 1.1950 | 1.1949 | +0.420 % | +0.412 % |
| V086e Spencer (Tandjiria, Low & Teh) | 1.219 | 1.2045 | 1.2044 | -1.189 % | -1.198 % |
| V086c Spencer (Tandjiria, Low & Teh (2002)) | 1.219 | 1.2063 | 1.2064 | -1.042 % | -1.034 % |
| V034a Spencer (Duncan & Wright) | 1.276 | 1.2763 | 1.2762 | +0.024 % | +0.016 % |
| V020 Spencer (Cheng et al.) | 1.330 | 1.3328 | 1.3329 | +0.211 % | +0.218 % |
| V019 Spencer (Cheng et al.) | 1.383 | 1.3984 | 1.3985 | +1.114 % | +1.121 % |
| V040 Bishop simplified (El-Ramly et al. (2002)) | 1.460 | 1.4592 | 1.4593 | -0.055 % | -0.048 % |
| V045 Spencer (Fredlund & Krahn) | 1.830 | 1.8274 | 1.8275 | -0.142 % | -0.137 % |
| V045 Morgenstern-Price (half-sine) (Fredlund & Krahn) | 1.832 | 1.8266 | 1.8267 | -0.295 % | -0.289 % |
| V045 Bishop simplified (Fredlund & Krahn) | 1.834 | 1.8289 | 1.8290 | -0.278 % | -0.273 % |
| V044 Spencer (Fredlund & Krahn) | 2.073 | 2.0720 | 2.0721 | -0.048 % | -0.043 % |
| V044 Morgenstern-Price (half-sine) (Fredlund & Krahn) | 2.076 | 2.0716 | 2.0717 | -0.212 % | -0.207 % |
| V044 Bishop simplified (Fredlund & Krahn) | 2.080 | 2.0759 | 2.0760 | -0.197 % | -0.192 % |
| V021f Bishop simplified (Chowdhury & Xu) | 2.140 | 2.1280 | 2.1281 | -0.542 % | -0.537 % |
| V021e Bishop simplified (Chowdhury & Xu) | 2.234 | 2.2448 | 2.2449 | +0.470 % | +0.474 % |
| **Mean error (n = 111)** | | | | -0.167 % | -0.154 % |
| **Mean absolute error** | | | | 1.011 % | 1.009 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-02: Tension crack at a limiting base inclination

Compared with dacb536. Errors are relative to the reference, in percent. Verification run time: 757 s (4 workers, load 4.9 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-02: Distributed loads normal to the ground

Compared with 72a2925. Errors are relative to the reference, in percent. Verification run time: 779 s (4 workers, load 4.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-02: Strength from suction (φb) above the water line

Compared with 751c204. Errors are relative to the reference, in percent. Verification run time: 770 s (4 workers, load 5.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-02: Combined S = f(depth) (drained c′ + σ′ tan φ′ limited by Su, c′ with depth); SGI 3D end faces take Su of combined clay

Compared with effcff5. Errors are relative to the reference, in percent. Verification run time: 849 s (4 workers, load 4.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-01: Warning for shallow critical surfaces in cohesionless soil; minimum entry-exit distance in the options

Compared with 73d12f2. Errors are relative to the reference, in percent. Verification run time: 424 s (4 workers, load 2.5 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-01: 3D effects of temporary slopes after SGI Vägledning 8

Compared with 96f7cc3. Errors are relative to the reference, in percent. Verification run time: 414 s (4 workers, load 3.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-01: Model-space helpers for analysed surfaces (toModelX, toModelCircle)

Compared with 17d004c. Errors are relative to the reference, in percent. Verification run time: 409 s (4 workers, load 3.9 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-01: Partial factors in Swedish practice from the safety class and eta

Compared with 6189216. Errors are relative to the reference, in percent. Verification run time: 416 s (4 workers, load 1.4 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-01: Anisotropy on the undrained strengths (undrained, from depth, from datum)

Compared with ab3ba2f. Errors are relative to the reference, in percent. Verification run time: 416 s (4 workers, load 4.4 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-11-01: Lower bound: fans of elements at the ends of loads and at corners

Compared with c2ab8d1. Errors are relative to the reference, in percent. Verification run time: 416 s (4 workers, load 3.1 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-10-30: FE factor of safety from the limit analysis bounds; Davis B bounds; no adaptive strength reduction for non-associated flow in the app

Compared with d44b204. Errors are relative to the reference, in percent. Verification run time: 666 s (4 workers, load 0.7 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.711 % | -0.711 % |
| **Mean absolute error** | | | | 2.399 % | 2.399 % |
| **RMS error** | | | | 3.712 % | 3.712 % |
| **Largest error** | | | | 15.100 % | 15.100 % |


### 2026-10-30: Refined meshes start from the coarser mesh's state (associated flow)

Compared with d8d0d25. Errors are relative to the reference, in percent. Verification run time: 594 s (4 workers, load 2.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 3 moved (1 closer to the reference, 2 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V020 finite-element strength reduction (Cheng et al. (2007)) | 1.327 | 1.3461 | 1.3529 | +1.439 % | +1.952 % |
| V059b finite elements (Guo & Griffiths (2020)) | 1.350 | 1.3492 | 1.3525 | -0.059 % | +0.185 % |
| V056 finite elements (read from fig. 7) (Griffiths & Lane (1999)) | 0.600 | 0.5091 | 0.5094 | -15.150 % | -15.100 % |
| **Mean error (n = 35)** | | | | -0.734 % | -0.711 % |
| **Mean absolute error** | | | | 2.383 % | 2.399 % |
| **RMS error** | | | | 3.711 % | 3.712 % |
| **Largest error** | | | | 15.150 % | 15.100 % |


### 2026-10-30: Lower bound: four elements at each corner of the ground surface, bracketed F searches, seepage heads at added nodes

Compared with 14cd592. Errors are relative to the reference, in percent. Verification run time: 544 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-30: Limit analysis bounds on second-order cones solved by Clarabel (WebAssembly)

Compared with ad6993f. Errors are relative to the reference, in percent. Verification run time: 513 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-30: Infinite-slope warning for faces in cohesionless soil

Compared with 60df874. Errors are relative to the reference, in percent. Verification run time: 485 s (4 workers, load 1.8 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: Faster bound gap refinement: coarse tolerance on the steering levels, lower bound started at the last bound, smallest element size limited

Compared with bc03291. Errors are relative to the reference, in percent. Verification run time: 440 s (4 workers, load 2.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: Anderson-accelerated viscoplastic iteration with the equilibrium test, as an option

Compared with cbff40d. Errors are relative to the reference, in percent. Verification run time: 476 s (4 workers, load 2.5 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: Limit analysis in the app refined on the gap between the lower and upper bound

Compared with d211478. Errors are relative to the reference, in percent. Verification run time: 670 s (4 workers, load 3.5 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: Newton: a return to the Mohr–Coulomb apex gets 10⁻³ of the elastic tangent instead of zero

Compared with 0ef8529. Errors are relative to the reference, in percent. Verification run time: 893 s (4 workers, load 4.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: Generalised Hoek-Brown rock in limit equilibrium and FE

Compared with 5f5cacf. Errors are relative to the reference, in percent. Verification run time: 933 s (4 workers, load 5.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: FE: embedded pile rows, anchors with free length and lock-off load

Compared with 998c51c. Errors are relative to the reference, in percent. Verification run time: 1093 s (4 workers, load 5.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: Initial stresses (K0 procedure) and staged construction in FE, as options

Compared with ee90210. Errors are relative to the reference, in percent. Verification run time: 1160 s (4 workers, load 5.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: Upper bound limit analysis (Sloan & Kleeman 1995) and both bounds as an app option

Compared with 5138eb9. Errors are relative to the reference, in percent. Verification run time: 1088 s (4 workers, load 1.0 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: Non-associated Newton (unsymmetric tangent, LU) and equilibrium convergence test as options; F–displacement curve

Compared with 9b21aac. Errors are relative to the reference, in percent. Verification run time: 966 s (4 workers, load 4.8 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: FE solver speed-up: allocation-free stress return, scatter assembly, nested dissection with minimum-cover separators

Compared with 30256b4. Errors are relative to the reference, in percent. Verification run time: 966 s (4 workers, load 3.8 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -0.734 % | -0.734 % |
| **Mean absolute error** | | | | 2.383 % | 2.383 % |
| **RMS error** | | | | 3.711 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-29: FE references from a commercial FE program's verification manual on 15 problems; new problem V099 (ACADS 5, FE seepage)

Compared with 1b31150. Errors are relative to the reference, in percent. Verification run time: 1105 s (4 workers, load 0.9 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 35)** | | | | -1.058 % | -0.734 % |
| **Mean absolute error** | | | | 2.420 % | 2.383 % |
| **RMS error** | | | | 4.292 % | 3.711 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-28: Viscoplastic iteration: stresses beyond the Mohr-Coulomb apex relaxed towards it (V094-type cohesionless layer at the toe)

Compared with 7f08af8. Errors are relative to the reference, in percent. Verification run time: 305 s (4 workers, load 0.6 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 19)** | | | | -1.058 % | -1.058 % |
| **Mean absolute error** | | | | 2.420 % | 2.420 % |
| **RMS error** | | | | 4.292 % | 4.292 % |
| **Largest error** | | | | 15.150 % | 15.150 % |


### 2026-10-28: FE review fixes: Newton line search and stall test, confirmed failure bounds, local thin-layer size, engine-independent mesh, design strength and Tresca cap in FE, seepage side heads, certified lower bound

Compared with 00369ee. Errors are relative to the reference, in percent. Verification run time: 757 s (4 workers, load 2.9 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 18 moved (11 closer to the reference, 7 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V056 finite elements (read from fig. 7) (Griffiths & Lane (1999)) | 0.600 | 0.4772 | 0.5091 | -20.467 % | -15.150 % |
| V068 limit analysis, lower and upper bound (Kim et al. (2002)) | 1.130 | 1.1437 | 1.1767 | +1.212 % | +4.133 % |
| V002 limit analysis, lower and upper bound (Kim et al. (2002)) | 0.400 | 0.4182 | 0.4253 | +4.550 % | +6.325 % |
| V059c finite elements (read from fig. 2) (Guo & Griffiths (2020)) | 1.360 | 1.3454 | 1.3617 | -1.074 % | +0.125 % |
| V026 finite-element strength reduction (Duncan, Wright & Brandon (2014)) | 1.190 | 1.1727 | 1.1864 | -1.454 % | -0.303 % |
| V013a finite-element strength reduction (3D, without piles) (Cai & Ugai (2000)) | 1.140 | 1.1207 | 1.1327 | -1.693 % | -0.640 % |
| V057b finite elements (Griffiths & Lane (1999)) | 2.030 | 2.0259 | 2.0422 | -0.202 % | +0.601 % |
| V020 finite-element strength reduction (Cheng et al. (2007)) | 1.327 | 1.3359 | 1.3461 | +0.671 % | +1.439 % |
| V059a finite elements (read from fig. 2) (Guo & Griffiths (2020)) | 1.280 | 1.2729 | 1.2810 | -0.555 % | +0.078 % |
| V019 finite-element strength reduction (Cheng et al. (2007)) | 1.470 | 1.3974 | 1.4044 | -4.939 % | -4.463 % |
| V057a finite elements (Griffiths & Lane (1999)) | 1.450 | 1.4453 | 1.4514 | -0.324 % | +0.097 % |
| V038b finite-element strength reduction, piezometric line (Duncan, Wright & Brandon (2014)) | 1.070 | 1.0616 | 1.0655 | -0.785 % | -0.421 % |
| V059b finite elements (Guo & Griffiths (2020)) | 1.350 | 1.3443 | 1.3492 | -0.422 % | -0.059 % |
| V039 finite-element strength reduction (Duncan, Wright & Brandon (2014)) | 1.260 | 1.2436 | 1.2403 | -1.302 % | -1.563 % |
| V063 finite-element strength reduction (Huang & Jia (2009)) | 2.500 | 2.3974 | 2.4030 | -4.104 % | -3.880 % |
| V058 finite elements (Griffiths & Lane (1999)) | 1.900 | 1.8508 | 1.8536 | -2.589 % | -2.442 % |
| V077 plasticity theory (Prandtl (1920)) | 1.000 | 1.0000 | 1.0014 | 0.000 % | +0.140 % |
| V055 finite elements (Griffiths & Lane (1999)) | 1.400 | 1.3443 | 1.3424 | -3.979 % | -4.114 % |
| **Mean error (n = 19)** | | | | -1.971 % | -1.058 % |
| **Mean absolute error** | | | | 2.648 % | 2.420 % |
| **RMS error** | | | | 5.203 % | 4.292 % |
| **Largest error** | | | | 20.467 % | 15.150 % |


### 2026-10-28: Newton decides associated FE trials alone (viscoplastic referee removed); BFGS solver as an option

Compared with 22fb25d. Errors are relative to the reference, in percent. Verification run time: 1236 s (4 workers, load 0.7 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 8 moved (4 closer to the reference, 4 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V020 finite-element strength reduction (Cheng et al. (2007)) | 1.327 | 1.3666 | 1.3359 | +2.984 % | +0.671 % |
| V059c finite elements (read from fig. 2) (Guo & Griffiths (2020)) | 1.360 | 1.3721 | 1.3454 | +0.890 % | -1.074 % |
| V068 limit analysis, lower and upper bound (Kim et al. (2002)) | 1.130 | 1.1612 | 1.1437 | +2.761 % | +1.212 % |
| V057b finite elements (Griffiths & Lane (1999)) | 2.030 | 2.0485 | 2.0259 | +0.911 % | -0.202 % |
| V059a finite elements (read from fig. 2) (Guo & Griffiths (2020)) | 1.280 | 1.2825 | 1.2729 | +0.195 % | -0.555 % |
| V019 finite-element strength reduction (Cheng et al. (2007)) | 1.470 | 1.4080 | 1.3974 | -4.218 % | -4.939 % |
| V057a finite elements (Griffiths & Lane (1999)) | 1.450 | 1.4551 | 1.4453 | +0.352 % | -0.324 % |
| V059b finite elements (Guo & Griffiths (2020)) | 1.350 | 1.3510 | 1.3443 | +0.074 % | -0.422 % |
| **Mean error (n = 19)** | | | | -1.467 % | -1.971 % |
| **Mean absolute error** | | | | 2.806 % | 2.648 % |
| **RMS error** | | | | 5.243 % | 5.203 % |
| **Largest error** | | | | 20.467 % | 20.467 % |


### 2026-10-28: FE solver review: published methods only (bisection without collapse estimate, Aitken relaxation in seepage)

Compared with 68a5095. Errors are relative to the reference, in percent. Verification run time: 1196 s (4 workers, load 1.3 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 7 moved (3 closer to the reference, 4 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V013a finite-element strength reduction (3D, without piles) (Cai & Ugai (2000)) | 1.140 | 1.1394 | 1.1207 | -0.053 % | -1.693 % |
| V057b finite elements (Griffiths & Lane (1999)) | 2.030 | 2.0640 | 2.0485 | +1.675 % | +0.911 % |
| V058 finite elements (Griffiths & Lane (1999)) | 1.900 | 1.8413 | 1.8508 | -3.089 % | -2.589 % |
| V063 finite-element strength reduction (Huang & Jia (2009)) | 2.500 | 2.4082 | 2.3974 | -3.672 % | -4.104 % |
| V020 finite-element strength reduction (Cheng et al. (2007)) | 1.327 | 1.3632 | 1.3666 | +2.728 % | +2.984 % |
| V039 finite-element strength reduction (Duncan, Wright & Brandon (2014)) | 1.260 | 1.2405 | 1.2436 | -1.548 % | -1.302 % |
| V055 finite elements (Griffiths & Lane (1999)) | 1.400 | 1.3444 | 1.3443 | -3.971 % | -3.979 % |
| **Mean error (n = 19)** | | | | -1.370 % | -1.467 % |
| **Mean absolute error** | | | | 2.762 % | 2.806 % |
| **RMS error** | | | | 5.232 % | 5.243 % |
| **Largest error** | | | | 20.467 % | 20.467 % |


### 2026-10-28: Faster finite element strength reduction (sparse Cholesky, collapse estimate, guided refinement)

Compared with 956b6d6. Errors are relative to the reference, in percent. Verification run time: 1573 s (4 workers, load 1.2 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 19 moved (12 closer to the reference, 7 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V013a finite-element strength reduction (3D, without piles) (Cai & Ugai (2000)) | 1.140 | 1.1248 | 1.1394 | -1.333 % | -0.053 % |
| V020 finite-element strength reduction (Cheng et al. (2007)) | 1.327 | 1.3690 | 1.3632 | +3.165 % | +2.728 % |
| V055 finite elements (Griffiths & Lane (1999)) | 1.400 | 1.3497 | 1.3444 | -3.593 % | -3.971 % |
| V063 finite-element strength reduction (Huang & Jia (2009)) | 2.500 | 2.4176 | 2.4082 | -3.296 % | -3.672 % |
| V057b finite elements (Griffiths & Lane (1999)) | 2.030 | 2.0567 | 2.0640 | +1.315 % | +1.675 % |
| V002 limit analysis, lower and upper bound (Kim et al. (2002)) | 0.400 | 0.4196 | 0.4182 | +4.900 % | +4.550 % |
| V026 finite-element strength reduction (Duncan, Wright & Brandon (2014)) | 1.190 | 1.1768 | 1.1727 | -1.109 % | -1.454 % |
| V038b finite-element strength reduction, piezometric line (Duncan, Wright & Brandon (2014)) | 1.070 | 1.0580 | 1.0616 | -1.121 % | -0.785 % |
| V077 plasticity theory (Prandtl (1920)) | 1.000 | 1.0032 | 1.0000 | +0.320 % | 0.000 % |
| V056 finite elements (read from fig. 7) (Griffiths & Lane (1999)) | 0.600 | 0.4762 | 0.4772 | -20.633 % | -20.467 % |
| V057a finite elements (Griffiths & Lane (1999)) | 1.450 | 1.4574 | 1.4551 | +0.510 % | +0.352 % |
| V039 finite-element strength reduction (Duncan, Wright & Brandon (2014)) | 1.260 | 1.2424 | 1.2405 | -1.397 % | -1.548 % |
| V058 finite elements (Griffiths & Lane (1999)) | 1.900 | 1.8387 | 1.8413 | -3.226 % | -3.089 % |
| V068 limit analysis, lower and upper bound (Kim et al. (2002)) | 1.130 | 1.1600 | 1.1612 | +2.655 % | +2.761 % |
| V059b finite elements (Guo & Griffiths (2020)) | 1.350 | 1.3520 | 1.3510 | +0.148 % | +0.074 % |
| V059a finite elements (read from fig. 2) (Guo & Griffiths (2020)) | 1.280 | 1.2834 | 1.2825 | +0.266 % | +0.195 % |
| V018 plasticity theory (Prandtl mechanism) (Chen & Shao (1988)) | 1.000 | 0.9994 | 1.0000 | -0.060 % | 0.000 % |
| V059c finite elements (read from fig. 2) (Guo & Griffiths (2020)) | 1.360 | 1.3716 | 1.3721 | +0.853 % | +0.890 % |
| V019 finite-element strength reduction (Cheng et al. (2007)) | 1.470 | 1.4075 | 1.4080 | -4.252 % | -4.218 % |
| **Mean error (n = 19)** | | | | -1.363 % | -1.370 % |
| **Mean absolute error** | | | | 2.850 % | 2.762 % |
| **RMS error** | | | | 5.273 % | 5.232 % |
| **Largest error** | | | | 20.633 % | 20.467 % |


### 2026-10-28: Fixes from the finite element review (lower bound γsat and seepage pore pressures, seepage face, rigid materials, FE cache key)

Compared with 468c87f. Errors are relative to the reference, in percent. Verification run time: 1276 s (4 workers, load 0.8 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 19)** | | | | -1.363 % | -1.363 % |
| **Mean absolute error** | | | | 2.850 % | 2.850 % |
| **RMS error** | | | | 5.273 % | 5.273 % |
| **Largest error** | | | | 20.633 % | 20.633 % |


### 2026-10-28: FE step 3: reinforcement bars, seepage, robust strength reduction search; Leshchinsky & Han walls not compared

Compared with 4164cdc. Errors are relative to the reference, in percent. Verification run time: 3193 s (4 workers, load 1.4 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 19 moved (8 closer to the reference, 11 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V056 finite elements (read from fig. 7) (Griffiths & Lane (1999)) | 0.600 | 0.5367 | 0.4762 | -10.550 % | -20.633 % |
| V038b finite-element strength reduction, piezometric line (Duncan, Wright & Brandon (2014)) | 1.070 | 1.0308 | 1.0580 | -3.664 % | -1.121 % |
| V026 finite-element strength reduction (Duncan, Wright & Brandon (2014)) | 1.190 | 1.1643 | 1.1768 | -2.160 % | -1.109 % |
| V039 finite-element strength reduction (Duncan, Wright & Brandon (2014)) | 1.260 | 1.2347 | 1.2424 | -2.008 % | -1.397 % |
| V063 finite-element strength reduction (Huang & Jia (2009)) | 2.500 | 2.4056 | 2.4176 | -3.776 % | -3.296 % |
| V058 finite elements (Griffiths & Lane (1999)) | 1.900 | 1.8461 | 1.8387 | -2.837 % | -3.226 % |
| V055 finite elements (Griffiths & Lane (1999)) | 1.400 | 1.3447 | 1.3497 | -3.950 % | -3.593 % |
| V013a finite-element strength reduction (3D, without piles) (Cai & Ugai (2000)) | 1.140 | 1.1209 | 1.1248 | -1.675 % | -1.333 % |
| V068 limit analysis, lower and upper bound (Kim et al. (2002)) | 1.130 | 1.1562 | 1.1600 | +2.319 % | +2.655 % |
| V057a finite elements (Griffiths & Lane (1999)) | 1.450 | 1.4529 | 1.4574 | +0.200 % | +0.510 % |
| V057b finite elements (Griffiths & Lane (1999)) | 2.030 | 2.0523 | 2.0567 | +1.099 % | +1.315 % |
| V018 plasticity theory (Prandtl mechanism) (Chen & Shao (1988)) | 1.000 | 0.9978 | 0.9994 | -0.220 % | -0.060 % |
| V020 finite-element strength reduction (Cheng et al. (2007)) | 1.327 | 1.3676 | 1.3690 | +3.060 % | +3.165 % |
| V059c finite elements (read from fig. 2) (Guo & Griffiths (2020)) | 1.360 | 1.3729 | 1.3716 | +0.949 % | +0.853 % |
| V059a finite elements (read from fig. 2) (Guo & Griffiths (2020)) | 1.280 | 1.2826 | 1.2834 | +0.203 % | +0.266 % |
| V002 limit analysis, lower and upper bound (Kim et al. (2002)) | 0.400 | 0.4194 | 0.4196 | +4.850 % | +4.900 % |
| V059b finite elements (Guo & Griffiths (2020)) | 1.350 | 1.3514 | 1.3520 | +0.104 % | +0.148 % |
| V077 plasticity theory (Prandtl (1920)) | 1.000 | 1.0028 | 1.0032 | +0.280 % | +0.320 % |
| V019 finite-element strength reduction (Cheng et al. (2007)) | 1.470 | 1.4080 | 1.4075 | -4.218 % | -4.252 % |
| **Mean error (n = 19)** | | | | -1.158 % | -1.363 % |
| **Mean absolute error** | | | | 2.533 % | 2.850 % |
| **RMS error** | | | | 3.498 % | 5.273 % |
| **Largest error** | | | | 10.550 % | 20.633 % |


### 2026-10-27: Strength reduction by finite elements: FE column for 19 problems

Compared with f428b85. Errors are relative to the reference, in percent. Verification run time: 2418 s (4 workers, load 0.9 at start).

**Against other programs (midpoint of their range):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 279)** | | | | -0.231 % | -0.231 % |
| **Mean absolute error** | | | | 0.348 % | 0.348 % |
| **RMS error** | | | | 0.483 % | 0.483 % |
| **Largest error** | | | | 2.100 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.167 % | -0.167 % |
| **Mean absolute error** | | | | 1.011 % | 1.011 % |
| **RMS error** | | | | 1.595 % | 1.595 % |
| **Largest error** | | | | 6.591 % | 6.591 % |

**Finite elements against their references (FE, finite differences, limit analysis, theory):** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 19)** | | | | 0.000 % | -1.158 % |
| **Mean absolute error** | | | | 0.000 % | 2.533 % |
| **RMS error** | | | | 0.000 % | 3.498 % |
| **Largest error** | | | | 0.000 % | 10.550 % |


### 2026-10-25: Round three from 18 new sources: C&X, Cheng, D&W Table 14.1 and 2nd-edition values; new V010b, V038b, V086d-e on the sources' own input; V036 reference values printed, not read

Compared with 12fc2b1. Errors are relative to the reference, in percent. Verification run time: 103 s (4 workers, load 0.8 at start).

**Against other programs (midpoint of their range):** 2 moved (0 closer to the reference, 2 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V020 Spencer | 1.337 | 1.3382 | 1.3328 | +0.090 % | -0.314 % |
| V020 Bishop simplified | 1.342 | 1.3427 | 1.3373 | +0.052 % | -0.350 % |
| **Mean error (n = 279)** | | | | -0.235 % | -0.231 % |
| **Mean absolute error** | | | | 0.353 % | 0.348 % |
| **RMS error** | | | | 0.499 % | 0.483 % |
| **Largest error** | | | | 2.215 % | 2.100 % |

**Against the papers:** 0 moved (0 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| **Mean error (n = 111)** | | | | -0.078 % | -0.167 % |
| **Mean absolute error** | | | | 1.008 % | 1.011 % |
| **RMS error** | | | | 1.543 % | 1.595 % |
| **Largest error** | | | | 5.385 % | 6.591 % |


### 2026-10-25: Round two from the source extracts: V063 check is Bishop, Greco's global minimum 0.97 on V053, tiered-wall reinforcement 6.3 m, Morgenstern and Low reference values, Prandtl 1920

Compared with 990e4e9. Errors are relative to the reference, in percent. Verification run time: 107 s (4 workers, load 1.5 at start).

**Against other programs (midpoint of their range):** 1 moved (1 closer to the reference, 0 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V066b Spencer | 1.011 | 1.0105 | 1.0111 | -0.049 % | +0.010 % |
| **Mean error (n = 280)** | | | | -0.236 % | -0.235 % |
| **Mean absolute error** | | | | 0.353 % | 0.353 % |
| **RMS error** | | | | 0.499 % | 0.499 % |
| **Largest error** | | | | 2.215 % | 2.215 % |

**Against the papers:** 1 moved (0 closer to the reference, 1 further).

| Result | Reference | Before | After | Error before | Error after |
|---|---|---|---|---|---|
| V066b Bishop simplified, circular (Leshchinsky & Han (2004)) | 1.000 | 1.0126 | 1.0132 | +1.260 % | +1.320 % |
| **Mean error (n = 105)** | | | | -0.169 % | -0.078 % |
| **Mean absolute error** | | | | 0.955 % | 1.008 % |
| **RMS error** | | | | 1.464 % | 1.543 % |
| **Largest error** | | | | 5.385 % | 5.385 % |


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

