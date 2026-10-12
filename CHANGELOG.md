# Changelog

All notable changes to cSlope. Versions follow [semantic versioning](https://semver.org).

## [0.1.0] - Unreleased

The first public release.

### Analysis

- Bishop simplified, Janbu simplified with the f₀ correction, and Morgenstern–Price with constant (Spencer), half-sine, clipped-sine, trapezoidal and user-defined interslice functions.
- Circular and non-circular slip surfaces: grid and radius search, custom surfaces, non-circular optimisation, minimum slip depth and minimum sliding area, analysis in both slip directions.
- Tension cracks with a fixed or automatic (Rankine) depth, dry or water-filled.
- Partial factors to Eurocode 7.
- Sensitivity analysis, and probabilistic analysis with the Taylor series and Monte Carlo methods, with correlated variables.

### Model

- Exterior and interior boundaries with snapping, DXF import, and parameters with expressions.
- Material models: Mohr–Coulomb, undrained, strength increasing with depth (from the ground or from the top of the layer) or from a datum, with a strength cutoff, anisotropic, spatially varying, and lime-cement columns. Saturated unit weight below the water table.
- Water: a piezometric line per material, ponded water above the ground, water pressure lines.
- Distributed and line loads; anchors, soil nails, geosynthetics, sheet piles and piles.

### Results and reporting

- Critical surface, all surfaces or a factor-of-safety filter, slices, annotations and templates.
- Interslice force and slice plots, slice tables, export to Excel and PDF.

### Verification

- 180 published verification problems with 365 checks, run by the automated tests on every change.
