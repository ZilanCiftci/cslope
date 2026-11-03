//! A self-contained replacement of the parts of jsts (JTS 1.x as ported to
//! JavaScript, jsts 2.12.1) that `geometry-ops.ts` uses: snap-rounding
//! noding, the union of linework, polygonization, interior points and
//! point location. Each submodule ports the jsts classes it names, with the
//! same arithmetic and the same iteration orders, so that faces, their
//! order and their coordinates are those of jsts (see PORTING.md,
//! Decisions).

pub mod algorithm;
pub mod geomgraph;
pub mod interior_point;
pub mod noding;
pub mod overlay;
pub mod polygonize;
pub mod relate;
