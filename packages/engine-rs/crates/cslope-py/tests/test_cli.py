"""The ``cslope`` command (cslope.cli): output, JSON and exit codes."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import cslope
from cslope import build, cli
from cslope.build import Definition

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(list(map(str, argv)), out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def layered() -> Definition:
    d = Definition()
    d.exterior = [(0, 0), (0, 12), (16, 12), (32, 4), (44, 4), (44, 0)]
    d.add_material("Sand", c=3, phi=34, gamma=19, gamma_sat=20)
    d.add_material("Clay", c=12, phi=24, gamma=20, gamma_sat=20)
    d.add_interior_boundary([(0, 6), (28, 6)])
    d.assign("Sand", at=(8, 9))
    d.assign("Clay", at=(20, 2))
    d.search_limits(entry=(2, 18), exit=(28, 42))
    return d


@pytest.fixture
def doc_path(tmp_path):
    path = tmp_path / "Lager över lera.json"
    layered().save(path)
    return path


def test_analyse_prints_the_summary(doc_path):
    code, out, err = run("analyse", doc_path)
    assert code == 0, err
    assert out.startswith("F 1.802: factor of safety on characteristic values\n")
    assert "Method: Morgenstern-Price" in out
    assert "Critical surface: circle, center (" in out
    assert "Entry / exit: (" in out
    assert "Warnings: none" in out


def test_analyse_json(doc_path):
    code, out, _ = run("analyse", doc_path, "--json", "--threads", 1)
    assert code == 0
    data = json.loads(out)
    assert set(data) == {"summary", "result"}
    s = data["summary"]
    assert s["fos"] == pytest.approx(data["result"]["minFOS"])
    assert s["fos"] == pytest.approx(1.8020625879151726, abs=1e-6)
    assert s["methodName"] == "Morgenstern-Price"
    assert s["fosLabel"] == "factor of safety"
    assert isinstance(s["warnings"], list)
    assert data["result"]["criticalSurface"]["entryPoint"]


def test_analyse_with_partial_factors_says_over_design_factor(tmp_path):
    d = layered()
    d.options.partial_factors = build.swedish_partial_factors(
        safety_class=2, eta_cu=1.0, eta_drained=1.0, variable_load_base=1.3
    )
    path = tmp_path / "pf.json"
    d.save(path)
    code, out, _ = run("analyse", path)
    assert code == 0
    assert "over-design factor on design values" in out.splitlines()[0]
    assert "Partial factors: γcu = 1.5 (undrained strength)" in out
    assert "safety class 2 (γd = 0.91)" in out


def test_invalid_input_exits_2(tmp_path):
    missing = tmp_path / "missing.json"
    assert run("analyse", missing)[0] == 2
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json", encoding="utf-8")
    code, _, err = run("analyse", bad)
    assert code == 2 and "not valid JSON" in err
    other = tmp_path / "other.json"
    other.write_text(json.dumps({"format": "something", "definition": {}}), encoding="utf-8")
    assert run("analyse", other)[0] == 2
    # the engine cannot read it: a point with one coordinate
    broken = layered().to_dict()
    broken["definition"]["coordinates"][0] = [0.0]
    path = tmp_path / "broken.json"
    path.write_text(json.dumps(broken), encoding="utf-8")
    assert run("analyse", path)[0] == 2
    assert run("analyse", tmp_path / "x.json", "--threads", 0)[0] == 2
    assert run("no-such-command")[0] == 2


def test_analysis_error_exits_1(doc_path, monkeypatch):
    def fail(*args, **kwargs):
        raise cslope.EngineError("No valid slip surface was found.")

    monkeypatch.setattr(cslope, "analyse", fail)
    code, _, err = run("analyse", doc_path)
    assert code == 1
    assert "No valid slip surface was found." in err


def test_validation_errors_exit_2_with_their_paths(doc_path, monkeypatch):
    issue = {
        "path": "/definition/regionAssignments",
        "code": "region-unassigned",
        "message": "A region has no material.",
        "severity": "error",
    }
    monkeypatch.setattr(cslope, "validate", lambda doc, options=None: [issue])
    code, _, err = run("analyse", doc_path)
    assert code == 2
    assert "/definition/regionAssignments: A region has no material." in err
    code, out, _ = run("validate", doc_path)
    assert code == 2
    assert "/definition/regionAssignments" in out
    monkeypatch.setattr(cslope, "validate", lambda doc, options=None: [])
    assert run("validate", doc_path)[:2] == (0, "Valid.\n")


def test_a_missing_region_assignment_exits_2(tmp_path):
    doc = layered().to_dict()
    del doc["definition"]["regionAssignments"][1]
    path = tmp_path / "unassigned.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    code, out, _ = run("validate", path)
    assert code == 2
    assert "/definition/regionAssignments" in out or "/definition/materialBoundaries" in out
    assert run("analyse", path)[0] == 2


def test_validate_a_valid_document(doc_path):
    assert run("validate", doc_path)[0] == 0


def test_schema():
    code, out, _ = run("schema")
    assert code == 0
    assert isinstance(json.loads(out), dict)


def test_schema_by_name():
    for name in cslope.SCHEMA_NAMES:
        code, out, _ = run("schema", name)
        assert code == 0
        assert cslope.SCHEMA_VERSION in json.loads(out)["$id"]
    code, _, err = run("schema", "no-such-schema")
    assert code == 2 and "analysis-document" in err


def test_info():
    code, out, _ = run("info")
    assert code == 0
    assert "cslope {}".format(cslope.__version__) in out
    assert cslope.ENGINE_BUILD in out


def test_stdout_is_utf8(doc_path):
    # A non-UTF-8 console (as on Windows) must not break on model names or γ.
    d = layered()
    d.options.partial_factors = build.swedish_partial_factors(
        safety_class=3, eta_cu=1.0, eta_drained=1.0, variable_load_base=1.3
    )
    d.save(doc_path)
    env = dict(os.environ, PYTHONIOENCODING="ascii")
    p = subprocess.run(
        [sys.executable, "-m", "cslope.cli", "analyse", str(doc_path)], capture_output=True, env=env
    )
    assert p.returncode == 0, p.stderr.decode("utf-8", "replace")
    assert "γcu".encode("utf-8") in p.stdout


def test_entry_point():
    if not PYPROJECT.is_file():
        pytest.skip("pyproject.toml is not in this checkout")
    text = PYPROJECT.read_text(encoding="utf-8")
    assert '[project.scripts]\n' in text
    assert 'cslope = "cslope.cli:main"' in text
