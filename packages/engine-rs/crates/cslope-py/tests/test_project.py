"""cslope.project: opening, changing and saving .cslp project files with the
engine's reader and writer (crate cslope-project, issue #58), and
``cslope analyse site.cslp [--write]``.

The fixtures are the desktop app's (packages/desktop/src/features/project/
fixtures) and a project the app saved with its results (tests/data); the
tests that need them are skipped when the repository is not there (a wheel
test).
"""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from pathlib import Path

import pytest

import cslope
from cslope import cli, project

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parents[3] / "desktop" / "src" / "features" / "project" / "fixtures"
APP_RESULTS = HERE / "data" / "app-results.cslp"

needs_fixtures = pytest.mark.skipif(not FIXTURES.is_dir(), reason="the desktop fixtures are not in this checkout")
needs_app_results = pytest.mark.skipif(not APP_RESULTS.is_file(), reason="the app-saved project is not in this checkout")


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(list(map(str, argv)), out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def entries(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def rewritten(src, target, name, edit):
    """A copy of the archive ``src`` with the JSON entry ``name`` edited."""
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info)
            if info.filename == name:
                v = json.loads(data)
                edit(v)
                data = json.dumps(v).encode()
            zout.writestr(info.filename, data)
    return target


def test_versions_are_the_apps():
    assert (project.FORMAT_VERSION, project.SCHEMA_VERSION) == (1, 3)


@needs_fixtures
def test_opens_the_apps_fixtures():
    with project.open(FIXTURES / "cslp-v1.cslp") as p:
        assert p.layout == "cslp" and p.manifest["formatVersion"] == 1 and (p.version, p.units) == (3, "SI")
        assert [m.id for m in p.models] == ["model-1", "model-2"] and p.active_model.name == "Second model"
        assert p.models[0].min_fos == 1.25 and len(p.models[0].result.saved["inputHash"]) == 64
        assert p.models[1].result is None and p.models[1].error == "No admissible surface"
        (asset,) = p.assets
        assert asset.original_name == "section.png" and p.models[0].backgrounds[0]["assetId"] == asset.id
        assert p.read_asset(asset.id)[:8] == b"\x89PNG\r\n\x1a\n" and asset.path.endswith(".png")
        assert p.thumbnail() == p.read_asset(asset.id)
        # the first form of backgrounds.json, converted (1 x 1 px image: its bottom-left corner at (0, -5))
        (old,) = p.placements(p.models[0])
        assert old.calibration == {"mode": "drawing", "points": []}
        assert old.to_model(0, 1) == pytest.approx((0, -5)) and old.to_model(1, 0) == pytest.approx((0.1, -4.9))
        # the model as the app holds it: the members it fills are there
        assert {"projectInfo", "resultViewSettings", "options", "analysisLimits"} <= set(p.models[0].data)
    with project.open(FIXTURES / "cslp-v1-drawings.cslp") as p:
        (pdf,) = p.assets
        assert pdf.mime == "application/pdf" and p.read_asset(pdf.id)[:5] == b"%PDF-"
        (a,) = p.placements(p.models[0])
        (b,) = p.placements(p.models[1])
        assert (a.asset_id, a.page, a.name, a.locked, a.show_in_results) == (pdf.id, 1, "Section A-A", True, True)
        assert (b.asset_id, b.page, b.calibration["mode"]) == (pdf.id, 2, "points")
        assert a.calibration["mode"] == "axes" and a.crop == b.crop
        # vertical exaggeration 2: twice the metres per point along x as along y
        assert abs(a.transform[0]) == pytest.approx(2 * abs(a.transform[3]))


@needs_fixtures
@pytest.mark.parametrize("name", ["cslp-3file.cslp", "legacy-json-v3.json", "legacy-json-v1.json"])
def test_refuses_earlier_versions_pointing_to_the_app(name):
    with pytest.raises(ValueError, match="earlier cSlope.*open it in the cSlope app and save it"):
        project.open(FIXTURES / name)


@needs_fixtures
def test_refuses_unknown_members_and_newer_files(tmp_path):
    src = FIXTURES / "cslp-v1.cslp"
    bad = rewritten(src, tmp_path / "a.cslp", "models/model-1/model.json", lambda v: v["udls"][0].update(note="x"))
    with pytest.raises(ValueError, match=r"unknown member udls\[0\]\.note"):
        project.open(bad)
    newer = rewritten(src, tmp_path / "b.cslp", "project.json", lambda v: v.update(version=4))
    with pytest.raises(ValueError, match="newer cSlope"):
        project.open(newer)
    with pytest.raises(OSError):
        project.open(tmp_path / "none.cslp")


def test_read_is_a_deprecated_alias(tmp_path):
    with pytest.deprecated_call(), pytest.raises(OSError):
        project.read(tmp_path / "none.cslp")


@needs_fixtures
def test_saves_the_same_json_entries(tmp_path):
    for name in ["cslp-v1.cslp", "cslp-v1-drawings.cslp"]:
        p = project.open(FIXTURES / name)
        target = tmp_path / name
        assert p.save(target) == {"droppedResults": [], "droppedThumbnail": False}
        before, after = entries(FIXTURES / name), entries(target)
        assert list(after) == list(before)
        for n in before:
            if n == "manifest.json":
                a, b = json.loads(after[n]), json.loads(before[n])
                assert a["created"] == b["created"] and a["generator"].startswith("cslope ")
            elif n.endswith("backgrounds.json") and b"originX" in before[n]:
                continue  # the first form is written in the current one
            else:
                assert after[n] == before[n], (name, n)
        assert p.manifest["generator"] == json.loads(after["manifest.json"])["generator"]


@needs_fixtures
def test_a_model_changed_keeps_no_result_and_the_thumbnail_goes(tmp_path):
    p = project.open(FIXTURES / "cslp-v1.cslp")
    m = p.models[0]
    assert m.result_is_current
    m.data["materials"][0]["model"]["unitWeight"] += 1
    assert not m.result_is_current
    # a change that is not part of the input keeps it
    p.models[1].data["name"] = "Renamed"
    report = p.save(tmp_path / "x.cslp")
    # (the thumbnail shows the active model, model-2, whose result stays)
    assert report == {"droppedResults": ["model-1"], "droppedThumbnail": False}
    names = entries(tmp_path / "x.cslp")
    assert "models/model-1/result.json" not in names and "thumbnail.png" in names
    assert "models/model-2/result.json" in names
    assert m.result is None
    p.active_model.data["materials"][0]["model"]["unitWeight"] += 1
    assert p.save(tmp_path / "y.cslp") == {"droppedResults": ["model-2"], "droppedThumbnail": True}
    assert "thumbnail.png" not in entries(tmp_path / "y.cslp") and p.thumbnail() is None


@needs_fixtures
def test_a_result_a_newer_cslope_extended_is_left_out_with_a_warning(tmp_path):
    src = FIXTURES / "cslp-v1.cslp"
    newer = rewritten(src, tmp_path / "n.cslp", "models/model-1/result.json", lambda v: v["result"].update(newField=1))
    with pytest.warns(UserWarning, match="model-1 was left out.*newField"):
        p = project.open(newer)
    assert p.models[0].result is None and p.models[1].error == "No admissible surface"


@needs_fixtures
def test_an_unknown_member_added_in_python_is_refused_on_save(tmp_path):
    p = project.open(FIXTURES / "cslp-v1.cslp")
    p.models[0].data["comment"] = "x"
    with pytest.raises(ValueError, match="unknown member comment"):
        p.save(tmp_path / "x.cslp")
    assert not (tmp_path / "x.cslp").exists()


@needs_app_results
def test_analyse_write_keeps_current_results(tmp_path):
    target = shutil.copy(APP_RESULTS, tmp_path / "site.cslp")
    p = project.open(target)
    sparse = p.model("Fields missing")
    before = sparse.min_fos
    # the strength raised: the saved result is out of date until the model runs again
    sparse.data["materials"][0]["model"]["cohesion"] += 5
    p.save(target)
    assert project.open(target).model("Fields missing").result is None
    code, out, err = run("analyse", target, "--model", "Fields missing", "--write", "--threads", 2)
    assert code == 0, err
    assert out.startswith("Fields missing:\nF ") and "Saved " in out
    again = project.open(target).model("Fields missing")
    assert again.result_is_current and again.min_fos > before
    assert again.result.saved["engine"] == {"version": cslope.__version__, "sourceHash": ""}
    assert again.result.saved["runState"] == "done" and again.result.saved["errorMessage"] is None


@needs_app_results
def test_analyse_prints_without_writing(tmp_path):
    code, out, err = run("analyse", APP_RESULTS, "--json", "--threads", 2)
    assert code == 0, err
    data = json.loads(out)
    assert set(data) == {"id", "name", "summary", "result"}
    code, _, err = run("analyse", APP_RESULTS, "--model", "Nope")
    assert code == 2 and "No model named 'Nope'" in err
    doc = tmp_path / "d.json"
    doc.write_text(json.dumps({"format": "cslope-analysis", "formatVersion": 1, "definition": {}}))
    code, _, err = run("analyse", doc, "--write")
    assert code == 2 and "for a project file" in err


@needs_fixtures
def test_a_name_that_is_not_unicode_is_named(tmp_path):
    p = project.open(FIXTURES / "cslp-v1.cslp")
    p.models[0].data["name"] = "a\ud800b"
    with pytest.raises(ValueError, match=r"models\[0\]\.model\.name holds a lone surrogate"):
        p.save(tmp_path / "x.cslp")
