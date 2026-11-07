"""The browser app's templates, run by the Python package (#86).

The web app (packages/web) saves the analysis documents of its templates'
named parameter sets under src/templates/fixtures (the excavation's) and
fixtures/embankment, with F of each, computed by the engine in the browser
build, in expected.json beside them (scripts/write-fixtures.ts). Each
document is run here through the Python API and the ``cslope analyse``
command and must give the same F within 1e-6, so that the browser and
Python stay on the same engine result.

The fixtures live in the repository, not in the package: the tests skip when
packages/web is not checked out (the wheels workflow checks out only the
tests), and fail when it is but the fixtures are missing.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

import cslope
from cslope import cli

WEB = Path(__file__).resolve().parents[5] / "packages" / "web"
FIXTURES = WEB / "src" / "templates" / "fixtures"
TEMPLATES = {"excavation": FIXTURES, "embankment": FIXTURES / "embankment"}

needs_web = pytest.mark.skipif(not WEB.is_dir(), reason="packages/web is not in this checkout")


def fixtures():
    """(template, name, document path, expected entry) for every fixture."""
    if not WEB.is_dir():
        return []
    cases = []
    for template, folder in TEMPLATES.items():
        expected = json.loads((folder / "expected.json").read_text(encoding="utf-8"))
        for name, entry in expected.items():
            cases.append(pytest.param(template, name, folder / f"{name}.json", entry, id=f"{template}/{name}"))
    return cases


CASES = fixtures()


@needs_web
def test_every_fixture_has_an_expected_f():
    # Both templates have their sets, and each document has a pinned F (and
    # each pinned F a document), so that none is left out silently.
    for template, folder in TEMPLATES.items():
        expected = json.loads((folder / "expected.json").read_text(encoding="utf-8"))
        documents = {p.stem for p in folder.glob("*.json")} - {"expected"}
        assert documents, f"no {template} fixtures in {folder}"
        assert documents == set(expected), template
    assert len(CASES) >= 20


@needs_web
@pytest.mark.parametrize(("template", "name", "path", "entry"), CASES)
def test_the_python_api_gives_the_pinned_f(template, name, path, entry):
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert doc["format"] == "cslope-analysis"
    errors = [i for i in cslope.validate(doc) if i["severity"] == "error"]
    assert errors == []
    result = cslope.analyse(doc)
    summary = cslope.summarize(result, doc)
    assert summary["fosLabel"] == entry["fosLabel"]
    assert summary["fos"] == pytest.approx(entry["fos"], abs=1e-6)


@needs_web
@pytest.mark.parametrize("template", list(TEMPLATES))
def test_cslope_analyse_gives_the_pinned_f(template):
    # The command runs the same path; one set of each template is enough.
    case = next(c for c in CASES if c.values[0] == template)
    _, name, path, entry = case.values
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(["analyse", str(path), "--json"], out=out, err=err)
    assert code == 0, err.getvalue()
    summary = json.loads(out.getvalue())["summary"]
    assert summary["fosLabel"] == entry["fosLabel"], name
    assert summary["fos"] == pytest.approx(entry["fos"], abs=1e-6), name
