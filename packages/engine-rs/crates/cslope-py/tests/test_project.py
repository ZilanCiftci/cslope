"""cslope.project: reading .cslp project files (pure Python, no engine).

Runs without the compiled extension: the module is loaded from its file
when the package cannot be imported. The fixtures are the desktop app's
(packages/desktop/src/features/project/fixtures); the tests that need them
are skipped when the repository is not there (a wheel test).
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parents[3] / "desktop" / "src" / "features" / "project" / "fixtures"

try:
    from cslope import project
except ImportError:  # no compiled engine: the module on its own
    _spec = importlib.util.spec_from_file_location("cslope_project", HERE.parent / "python" / "cslope" / "project.py")
    assert _spec and _spec.loader
    project = importlib.util.module_from_spec(_spec)
    sys.modules["cslope_project"] = project
    _spec.loader.exec_module(project)

PNG = bytes.fromhex("89504e470d0a1a0a0000000d494844520000000100000001080600000" "01f15c4890000000d49444154789c63646060f8df0f0002870180eb47ba920000000049454e44ae426082")

MODEL = {
    "name": "Slope",
    "coordinates": [[0, 0], [10, 0], [20, 5], [30, 5]],
    "materials": [{"id": "mat-1", "name": "Clay", "model": {"kind": "mohr-coulomb", "unitWeight": 18, "frictionAngle": 0, "cohesion": 12}}],
}


def archive(entries: dict, manifest: dict | None = None) -> io.BytesIO:
    """A .cslp archive in memory of the given entries (dicts as JSON)."""
    manifest = manifest or {"format": "cslope-project", "formatVersion": 1, "minReaderVersion": 1, "appVersion": "0.1.0", "generator": "cSlope 0.1.0"}
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest))
        for name, value in entries.items():
            z.writestr(name, value if isinstance(value, (bytes, str)) else json.dumps(value))
    out.seek(0)
    return out


def layout(models: dict, extra: dict | None = None) -> dict:
    files = {"project.json": {"version": 3, "activeModelId": next(iter(models)), "models": list(models), "units": "SI", "settings": {}}}
    for mid, (data, result) in models.items():
        files[f"models/{mid}/model.json"] = data
        if result is not None:
            files[f"models/{mid}/result.json"] = result
    files.update(extra or {})
    return files


def test_reads_this_layout_with_results_backgrounds_and_assets():
    result = {"runState": "done", "result": {"minFOS": 1.25, "method": "Bishop"}, "errorMessage": None, "inputHash": "0" * 64, "engine": {"version": "0.1.0", "sourceHash": "abc"}}
    sha = hashlib.sha256(PNG).hexdigest()
    files = layout(
        {"a": (dict(MODEL, runState="running", result={"minFOS": 9}), result), "b": (dict(MODEL, name="Second"), {"runState": "error", "result": None, "errorMessage": "No surface"})},
        {
            "models/a/backgrounds.json": [{"assetId": "img", "transform": {"originX": 0, "originY": 0, "scale": 0.1, "rotationDeg": 0, "mirrored": False}, "opacity": 1, "visible": True, "order": 0}],
            "assets/index.json": [{"id": "img", "path": "assets/img.png", "mime": "image/png", "bytes": len(PNG), "sha256": sha, "originalName": "plan.png", "addedAt": "2026-11-04T00:00:00.000Z"}],
            "assets/img.png": PNG,
            "thumbnail.png": PNG,
        },
    )
    with project.read(archive(files)) as p:  # type: ignore[arg-type]
        assert p.layout == "cslp"
        assert p.manifest["generator"] == "cSlope 0.1.0"
        assert (p.version, p.active_model_id, p.units) == (3, "a", "SI")
        assert [m.id for m in p.models] == ["a", "b"]
        a = p.active_model
        assert a.name == "Slope" and a.data["coordinates"][2] == [20, 5]
        # the outcome comes from result.json only
        assert "runState" not in a.data and "result" not in a.data
        assert a.min_fos == 1.25 and a.result["engine"]["version"] == "0.1.0"
        assert p.model("b").result == {"runState": "error", "result": None, "errorMessage": "No surface"}
        assert p.model("b").min_fos is None
        assert a.backgrounds[0]["assetId"] == "img"
        assert [x.id for x in p.assets] == ["img"] and p.asset("img").original_name == "plan.png"
        assert p.read_asset("img") == PNG
        assert p.thumbnail() == PNG
        with pytest.raises(KeyError):
            p.model("c")


def test_checks_an_attachment_against_its_hash_and_drops_bad_index_entries():
    good = {"id": "img", "path": "assets/img.png", "mime": "image/png", "bytes": len(PNG), "sha256": "0" * 64, "originalName": "plan.png", "addedAt": ""}
    p = project.read(archive(layout({"a": (MODEL, None)}, {"assets/index.json": [good], "assets/img.png": PNG})))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="plan.png does not match its hash"):
        p.read_asset("img")
    for bad in (dict(good, bytes=1), dict(good, path="assets/other.png"), dict(good, id="../x")):
        p = project.read(archive(layout({"a": (MODEL, None)}, {"assets/index.json": [bad], "assets/img.png": PNG})))  # type: ignore[arg-type]
        assert p.assets == []
    assert p.thumbnail() is None


def test_refuses_a_newer_file_and_damaged_archives():
    files = layout({"a": (MODEL, None)})
    with pytest.raises(ValueError, match=r"newer cSlope \(cSlope 9.0\); update to open it"):
        project.read(archive(files, {"format": "cslope-project", "formatVersion": 2, "minReaderVersion": 2, "generator": "cSlope 9.0"}))  # type: ignore[arg-type]
    # a newer format that this reader may read opens
    assert project.read(archive(files, {"format": "cslope-project", "formatVersion": 2, "minReaderVersion": 1})).models[0].name == "Slope"  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="another format"):
        project.read(archive(files, {"format": "x", "formatVersion": 1}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="no valid formatVersion"):
        project.read(archive(files, {"format": "cslope-project", "formatVersion": "1"}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="models/ghost/model.json is missing"):
        project.read(archive(dict(files, **{"project.json": dict(files["project.json"], models=["a", "ghost"])})))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="no manifest.json"):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as z:
            z.writestr("project.json", "{}")
        out.seek(0)
        project.read(out)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="not valid JSON"):
        project.read(archive(dict(files, **{"models/a/model.json": "{"})))  # type: ignore[arg-type]


def _declare_size(data: bytes, name: str, size: int) -> io.BytesIO:
    """The archive with `name`'s uncompressed size in the central directory set to `size`."""
    buf = bytearray(data)
    at = 0
    while True:
        at = buf.index(b"PK\x01\x02", at)
        name_len = int.from_bytes(buf[at + 28 : at + 30], "little")
        if bytes(buf[at + 46 : at + 46 + name_len]) == name.encode():
            buf[at + 24 : at + 28] = size.to_bytes(4, "little")
            return io.BytesIO(bytes(buf))
        at += 4


def test_refuses_archives_larger_than_the_limits(monkeypatch: pytest.MonkeyPatch):
    files = layout({"a": (MODEL, None)}, {"thumbnail.png": PNG})
    data = archive(files).getvalue()
    mb = 1024 * 1024
    # A declared size above 100 MB is refused before anything is read.
    with pytest.raises(ValueError, match=r"entry project.json is too large \(150 MB unpacked; at most 100 MB\)"):
        project.read(_declare_size(data, "project.json", 150 * mb))  # type: ignore[arg-type]
    # So are entries that unpack to more than 200 MB together.
    big_data = _declare_size(_declare_size(data, "models/a/model.json", 90 * mb).getvalue(), "thumbnail.png", 90 * mb).getvalue()
    big_data = _declare_size(big_data, "project.json", 30 * mb).getvalue()
    with pytest.raises(ValueError, match=r"unpack to more than 200 MB"):
        project.read(io.BytesIO(big_data))  # type: ignore[arg-type]
    # The limits are those of the module.
    monkeypatch.setattr(project, "MAX_ENTRY_BYTES", 50)
    with pytest.raises(ValueError, match="too large"):
        project.read(archive(files))  # type: ignore[arg-type]


def test_refuses_units_other_than_si(tmp_path: Path):
    files = layout({"a": (MODEL, None)})
    imperial = dict(files, **{"project.json": dict(files["project.json"], units="imperial")})
    with pytest.raises(ValueError, match="in imperial units; this reader reads SI projects only"):
        project.read(archive(imperial))  # type: ignore[arg-type]
    f = tmp_path / "old.json"
    f.write_text(json.dumps({"units": 3, "models": [dict(MODEL, id="m1")]}), encoding="utf-8")
    with pytest.raises(ValueError, match="in unknown units"):
        project.read(f)
    # Without units, SI.
    f.write_text(json.dumps({"models": [dict(MODEL, id="m1")]}), encoding="utf-8")
    assert project.read(f).units == "SI"


def test_reads_the_first_cslp_layout_and_json_projects(tmp_path: Path):
    model = dict(MODEL, id="m1")
    old = {"project.json": {"version": 3, "activeModelId": "m1", "models": [model]}, "results.json": {"models": {"m1": {"runState": "done", "result": {"minFOS": 1.5}, "errorMessage": None}}}}
    p = project.read(archive(old, {"format": "cslope-project", "formatVersion": 1}))  # type: ignore[arg-type]
    assert p.layout == "cslp-3file" and p.models[0].min_fos == 1.5 and "result" not in p.models[0].data
    f = tmp_path / "old.json"
    f.write_text("﻿" + json.dumps({"activeModelId": "m1", "models": [dict(model, runState="error", errorMessage="x")]}), encoding="utf-8")
    p = project.read(f)
    assert p.layout == "json" and p.version == 1 and p.models[0].result == {"runState": "error", "result": None, "errorMessage": "x"}
    (tmp_path / "no.txt").write_text("hello")
    with pytest.raises(ValueError, match="not a cSlope project"):
        project.read(tmp_path / "no.txt")


@pytest.mark.skipif(not FIXTURES.is_dir(), reason="the desktop fixtures are not in this checkout")
def test_opens_the_committed_fixtures():
    v1 = project.read(FIXTURES / "legacy-json-v1.json")
    assert v1.layout == "json" and v1.models[0].name == "Legacy v1 slope"
    v3 = project.read(FIXTURES / "legacy-json-v3.json")
    assert v3.active_model_id == "model-2" and v3.models[0].min_fos == 1.25
    three = project.read(FIXTURES / "cslp-3file.cslp")
    assert three.layout == "cslp-3file" and [m.name for m in three.models] == ["Legacy v3 slope", "Second model"]
    with project.read(FIXTURES / "cslp-v1.cslp") as p:
        assert p.layout == "cslp" and p.manifest["formatVersion"] == 1
        assert [m.id for m in p.models] == ["model-1", "model-2"] and p.active_model.name == "Second model"
        assert p.models[0].min_fos == 1.25 and len(p.models[0].result["inputHash"]) == 64
        assert p.models[1].result["errorMessage"] == "No admissible surface"
        (asset,) = p.assets
        assert asset.original_name == "section.png" and p.models[0].backgrounds[0]["assetId"] == asset.id
        assert p.read_asset(asset.id)[:8] == b"\x89PNG\r\n\x1a\n"
        assert p.thumbnail() == p.read_asset(asset.id)
