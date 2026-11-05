//! The wrapper on a drawing acadrust writes itself, and on malformed input.

use acadrust::entities::{Arc, EntityType, Line, LwPolyline};
use acadrust::types::{DxfVersion, Vector2, Vector3};
use acadrust::{CadDocument, DwgWriter, Layer};
use cslope_dwg::{read_dwg, read_dwg_json};

/// A slope section: a closed outline, a material boundary drawn as two
/// LINEs, a water line, and an ARC (which the import does not read).
fn sample(version: DxfVersion) -> Vec<u8> {
    let mut doc = CadDocument::with_version(version);
    doc.header.insertion_units = 6; // meters
    for name in ["outline", "layer", "piezo"] {
        doc.layers.add(Layer::new(name)).unwrap();
    }
    let mut outline = LwPolyline::from_points(
        [
            [0.0, -20.0],
            [0.0, -10.0],
            [20.0, -10.0],
            [40.0, 0.0],
            [60.0, 0.0],
            [60.0, -20.0],
        ]
        .iter()
        .map(|p| Vector2::new(p[0], p[1]))
        .collect(),
    );
    outline.is_closed = true;
    outline.common.layer = "outline".into();
    doc.add_entity(EntityType::LwPolyline(outline)).unwrap();
    for (a, b) in [
        ([0.0, -14.0], [30.0, -13.0]),
        ([30.0, -13.0], [60.0, -12.0]),
    ] {
        let mut line = Line::from_coords(a[0], a[1], 0.0, b[0], b[1], 0.0);
        line.common.layer = "layer".into();
        doc.add_entity(EntityType::Line(line)).unwrap();
    }
    let mut piezo =
        LwPolyline::from_points(vec![Vector2::new(0.0, -10.0), Vector2::new(60.0, -4.0)]);
    piezo.common.layer = "piezo".into();
    doc.add_entity(EntityType::LwPolyline(piezo)).unwrap();
    let arc = Arc::from_center_radius_angles(Vector3::new(30.0, -10.0, 0.0), 5.0, 0.0, 1.0);
    doc.add_entity(EntityType::Arc(arc)).unwrap();
    DwgWriter::write_to_vec(&doc).unwrap()
}

#[test]
fn reads_back_a_drawing_acadrust_wrote() {
    for (version, code) in [
        (DxfVersion::AC1015, "AC1015"),
        (DxfVersion::AC1018, "AC1018"),
        (DxfVersion::AC1032, "AC1032"),
    ] {
        let bytes = sample(version);
        let d = read_dwg(&bytes).unwrap_or_else(|e| panic!("{code}: {e}"));
        assert_eq!(d.version, code);
        assert_eq!(d.insunits, 6);
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
        assert_eq!(d.polylines.len(), 2, "{code}");
        let outline = d.polylines.iter().find(|p| p.layer == "outline").unwrap();
        assert!(outline.closed);
        assert_eq!(outline.points.len(), 6);
        assert_eq!(outline.points[3], [40.0, 0.0]);
        let piezo = d.polylines.iter().find(|p| p.layer == "piezo").unwrap();
        assert!(!piezo.closed);
        assert_eq!(d.segments.len(), 2);
        assert!(d.segments.iter().all(|s| s.layer == "layer"));
        assert_eq!(d.skipped.get("ARC"), Some(&1));
        assert!(d.layers.iter().any(|l| l == "piezo"));
    }
}

#[test]
fn json_uses_the_app_names() {
    let json = read_dwg_json(&sample(DxfVersion::AC1032)).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    for key in [
        "version",
        "insunits",
        "polylines",
        "segments",
        "skipped",
        "bulgedPolylines",
        "paperSpaceEntities",
        "layers",
        "warnings",
    ] {
        assert!(v.get(key).is_some(), "no {key} in {json}");
    }
}

#[test]
fn garbage_is_an_error() {
    assert!(read_dwg(b"").is_err());
    assert!(read_dwg(b"hello, this is not a drawing").is_err());
    assert!(read_dwg(&[0u8; 4096]).is_err());
    let mut fake = b"AC1032".to_vec();
    fake.extend(std::iter::repeat_n(0xA5u8, 8192));
    assert!(read_dwg(&fake).is_err());
}

#[test]
fn an_old_version_is_an_error_not_an_empty_drawing() {
    let mut r10 = b"AC1006".to_vec();
    r10.extend([0u8; 512]);
    let e = read_dwg(&r10).unwrap_err();
    assert!(e.contains("not supported"), "{e}");
}

/// Writes the desktop test's fixture (packages/desktop/src/features/project/
/// fixtures/slope-section.dwg): `cargo test --release -- --ignored write_fixture`.
#[test]
#[ignore = "writes the desktop fixture"]
fn write_fixture() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../desktop/src/features/project/fixtures/slope-section.dwg"
    );
    std::fs::write(path, sample(DxfVersion::AC1018)).unwrap();
}

/// Truncated and corrupted copies of a valid file: an error or a drawing,
/// never a panic that escapes `read_dwg` (the test would fail).
#[test]
fn damaged_files_fail_cleanly() {
    let bytes = sample(DxfVersion::AC1018);
    let mut errors = 0;
    for cut in (0..bytes.len()).step_by(bytes.len() / 40 + 1) {
        errors += usize::from(read_dwg(&bytes[..cut]).is_err());
    }
    assert!(errors > 0);
    // Deterministic byte flips (a small linear congruential generator).
    let mut seed: u64 = 12345;
    for _ in 0..40 {
        let mut damaged = bytes.clone();
        for _ in 0..8 {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let i = (seed >> 33) as usize % damaged.len();
            damaged[i] ^= (seed >> 17) as u8 | 1;
        }
        let _ = read_dwg(&damaged);
    }
}
