"""The ``cslope`` command: analyze, validate and describe analysis documents.

    cslope analyse slope.json [--json] [--threads N]
    cslope analyse site.cslp [--model NAME | --all] [--write] [--json] [--threads N]
    cslope validate slope.json
    cslope export site.cslp [--model NAME | --all] [-o PATH]
    cslope schema [name]
    cslope info

Exit status: 0 done, 1 the analysis failed, 2 the input is not valid.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import sys
from typing import Any, Dict, List, Optional, Sequence, TextIO

EXIT_OK = 0
EXIT_ANALYSIS = 1
EXIT_INVALID = 2


def _utf8(stream: TextIO) -> TextIO:
    """The stream as UTF-8 (model names on Windows consoles)."""
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is not None:
        try:
            reconfigure(encoding="utf-8")
            return stream
        except (ValueError, io.UnsupportedOperation):  # pragma: no cover - unusual streams
            pass
    buffer = getattr(stream, "buffer", None)
    if buffer is not None:  # pragma: no cover - streams without reconfigure
        return io.TextIOWrapper(buffer, encoding="utf-8", line_buffering=True)
    return stream


class _Invalid(Exception):
    """The input is not valid; ``issues`` are path/message dicts."""

    def __init__(self, issues: List[Dict[str, Any]]):
        super().__init__("invalid input")
        self.issues = issues


def _read(path: str) -> Dict[str, Any]:
    from .build import split_document

    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except OSError as e:
        raise _Invalid([{"path": "", "message": "Cannot read {}: {}".format(path, e.strerror or e)}]) from None
    except ValueError as e:
        raise _Invalid([{"path": "", "message": "{} is not valid JSON: {}".format(path, e)}]) from None
    try:
        split_document(doc)
    except (TypeError, ValueError) as e:
        raise _Invalid([{"path": "", "message": str(e)}]) from None
    return doc


def _print_issues(issues: List[Dict[str, Any]], out: TextIO) -> None:
    for i in issues:
        severity = i.get("severity", "error")
        where = " " + i["path"] if i.get("path") else ""
        out.write("{}{}: {}\n".format(severity, where, i.get("message")))


def _errors(issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [i for i in issues if i.get("severity", "error") == "error"]


def _finite(value: Any) -> Any:
    """``value`` with every non-finite number as None (JSON has no NaN)."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(v) for v in value]
    return value


def format_summary(summary: Dict[str, Any]) -> str:
    """The summary (``cslope.summarize``) as a few lines of text for a
    person, in the summary's own words."""
    lines = []
    fos = summary.get("fos")
    if fos is None:
        lines.append("F: none (no valid slip surface)")
    else:
        f_text = summary.get("fosText") or "{:.3f}".format(fos)
        lines.append("F {}: {} on {} values".format(f_text, summary.get("fosLabel"), summary.get("valueBasis")))
    pf = summary.get("partialFactors")
    if isinstance(pf, dict) and pf.get("text"):
        lines.append("Partial factors: {}".format(pf["text"]))
    if summary.get("method"):
        lines.append("Method: {}".format(summary["method"]))
    cs = summary.get("criticalSurface")
    if isinstance(cs, dict):
        lines.append("Critical surface: {}".format(cs.get("text")))
        if cs.get("entryExitText"):
            lines.append("Entry / exit: {}".format(cs["entryExitText"]))
    both = summary.get("bothDirections")
    if isinstance(both, dict) and both.get("text"):
        lines.append("Both directions: {}".format(both["text"]))
    if summary.get("nonConvergedText"):
        lines.append("Not converged: {}".format(summary["nonConvergedText"]))
    warnings = summary.get("warnings") or []
    if warnings:
        lines.append("Warnings:")
        lines.extend("- {}".format(w.get("message")) for w in warnings)
    else:
        lines.append("Warnings: none")
    if summary.get("engineBuild"):
        lines.append("Engine: {}".format(summary["engineBuild"]))
    return "\n".join(lines) + "\n"


def _is_archive(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(4) == b"PK\x03\x04"
    except OSError:
        return False


def _cmd_analyse(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

    if _is_archive(args.document):
        return _analyse_project(args, out, err)
    if args.write or args.all or args.model is not None:
        raise _Invalid([{"path": "", "message": "--model, --all and --write are for a project file (.cslp)."}])
    doc = _read(args.document)
    errors = _errors(cslope.validate(doc))
    if errors:
        raise _Invalid(errors)
    try:
        result = cslope.analyse(doc, threads=args.threads)
    except cslope.EngineError as e:
        err.write("The analysis failed: {}\n".format(e))
        return EXIT_ANALYSIS
    except (TypeError, ValueError) as e:  # the engine could not read the input
        raise _Invalid([{"path": "", "message": str(e)}]) from None
    summary = cslope.summarize(result, doc)
    if args.json:
        json.dump(_finite({"summary": summary, "result": result}), out, ensure_ascii=False, allow_nan=False)
        out.write("\n")
    else:
        out.write(format_summary(summary))
    return EXIT_OK


def _cmd_validate(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

    issues = cslope.validate(_read(args.document))
    _print_issues(issues, out)
    if _errors(issues):
        return EXIT_INVALID
    out.write("Valid{}.\n".format(" (with warnings)" if issues else ""))
    return EXIT_OK


#: The project schema version ``cslope export`` reads (the app's
#: PROJECT_FILE_VERSION): an older project is migrated by the app on open.
PROJECT_SCHEMA_VERSION = 3


def _free_water(definition: Dict[str, Any]) -> Dict[str, Any]:
    """The definition with the water's deprecated ``followBoundary`` (which
    the app writes) as ``freeWater``, its opposite (D-24; the engine reads
    them the same)."""
    tables = [definition.get("waterTable")] + list(definition.get("waterTables") or [])
    for w in tables:
        if isinstance(w, dict) and "followBoundary" in w and "freeWater" not in w:
            w["freeWater"] = not w.pop("followBoundary")
    return definition


def export_document(model: Dict[str, Any]) -> Dict[str, Any]:
    """The analysis document of a model of a project file (its
    ``model.json`` as a dict), as the app runs it: the model read as the app
    reads it on open (``cslope.normalize_model``), the engine's definition
    as the app makes it, in the model's own orientation (the water's free
    water as ``freeWater``, and each region the app leaves to the first
    material assigned to it explicitly), and the complete options.

    The project's ``inputHash`` (docs/file-format.md, section 5) is the hash
    of the definition in canonical orientation (sliding towards +x), so for
    a model facing left it is not the hash of this document's definition;
    ``cslope.to_canonical`` turns it."""
    import cslope

    from .build import DOCUMENT_FORMAT, DOCUMENT_FORMAT_VERSION

    from . import _native

    opened = cslope.normalize_model(model)
    definition = cslope.model_to_definition(opened, normalize=False)
    # each region the app leaves to the first material, said explicitly (#85)
    definition = _native.assign_unassigned_regions(definition)
    return {
        "format": DOCUMENT_FORMAT,
        "formatVersion": DOCUMENT_FORMAT_VERSION,
        "definition": _free_water(definition),
        "options": opened["options"],
    }


def _open_project(path: str) -> Any:
    """The project file at ``path`` (``cslope.project.open``), or an _Invalid
    with the reader's message (an earlier version: open it in the app and
    save it; a newer one: update)."""
    from . import project

    try:
        with open(path, "rb") as f:
            head = f.read(4096)
    except OSError as e:
        raise _Invalid([{"path": "", "message": "Cannot read {}: {}".format(path, e.strerror or e)}]) from None
    text = head.lstrip(b"\xef\xbb\xbf").lstrip()
    if text.startswith(b"{") and b'"cslope-analysis"' in head:
        raise _Invalid(
            [{"path": "", "message": "{} is an analysis document, not a project file; run it with `cslope analyse`.".format(path)}]
        )
    try:
        return project.open(path)
    except OSError as e:
        raise _Invalid([{"path": "", "message": "Cannot read {}: {}".format(path, e.strerror or e)}]) from None
    except ValueError as e:
        raise _Invalid([{"path": "", "message": "{}: {}".format(path, e)}]) from None


def _models_of(p: Any, args: argparse.Namespace) -> List[Any]:
    """The models ``--model`` / ``--all`` name (default: the active one)."""
    if args.all:
        return list(p.models)
    if args.model is not None:
        models = [m for m in p.models if m.name == args.model] or [m for m in p.models if m.id == args.model]
        if not models:
            names = ", ".join(repr(m.name) for m in p.models)
            raise _Invalid([{"path": "", "message": "No model named {!r} in {} (its models: {}).".format(args.model, args.document, names)}])
        if len(models) > 1:
            raise _Invalid(
                [{"path": "", "message": "{} models are named {!r}; give the id instead ({}).".format(len(models), args.model, ", ".join(m.id for m in models))}]
            )
        return models
    return [p.active_model]


def _analyse_project(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    """``cslope analyse site.cslp``: each model as the app runs it (the
    analysis document of ``cslope export``), its summary printed; with
    ``--write`` the results saved to the project (result.json in model
    coordinates with the input hash), under the save policy."""
    import cslope

    p = _open_project(args.document)
    status = EXIT_OK
    listed = []
    for m in _models_of(p, args):
        try:
            doc = export_document(m.data)
        except ValueError as e:
            raise _Invalid([{"path": "", "message": "Model {!r}: {}".format(m.name, e)}]) from None
        errors = _errors(cslope.validate(doc))
        if errors:
            raise _Invalid([dict(i, message="Model {!r}: {}".format(m.name, i.get("message"))) for i in errors])
        fem = (doc["options"].get("fem") or {}).get("enabled") is True
        try:
            result = cslope.analyse(doc, threads=args.threads)
        except cslope.EngineError as e:
            err.write("Model {!r}: the analysis failed: {}\n".format(m.name, e))
            status = EXIT_ANALYSIS
            if args.write and not fem:
                m.set_error(str(e))
            continue
        summary = cslope.summarize(result, doc)
        if args.json:
            listed.append({"id": m.id, "name": m.name, "summary": summary, "result": result})
        else:
            if len(p.models) > 1 or args.all:
                out.write("{}:\n".format(m.name))
            out.write(format_summary(summary))
        if args.write:
            if fem:
                # the app runs the finite element analysis with it; this does not
                err.write("Model {!r}: not written: its finite element analysis runs in the app only.\n".format(m.name))
            else:
                m.set_result(result)
    if args.json:
        json.dump(_finite(listed if args.all else (listed[0] if listed else None)), out, ensure_ascii=False, allow_nan=False)
        out.write("\n")
    if args.write:
        try:
            report = p.save(args.document)
        except OSError as e:
            raise _Invalid([{"path": "", "message": "Cannot write {}: {}".format(args.document, e)}]) from None
        except ValueError as e:
            raise _Invalid([{"path": "", "message": "{}: {}".format(args.document, e)}]) from None
        for model_id in report["droppedResults"]:
            err.write("Model {!r}: its saved result was for other input; dropped.\n".format(p.model(model_id).name))
        out_stream = err if args.json else out
        out_stream.write("Saved {}.\n".format(args.document))
    return status


_SAFE_NAME = re.compile(r"^[A-Za-z0-9_-]+$")


def _file_name(model_id: str, index: int, used: set) -> str:
    """A file name for a model: its id when that is a plain name, else its place."""
    base = model_id if _SAFE_NAME.match(model_id) else "model-{}".format(index + 1)
    name, k = base, 2
    while name in used:
        name, k = "{}-{}".format(base, k), k + 1
    used.add(name)
    return name + ".json"


def _cmd_export(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    from .build import dumps

    with _open_project(args.project) as p:
        args.document = args.project
        models = _models_of(p, args)
        docs = []
        for m in models:
            try:
                docs.append((m, export_document(m.data)))
            except ValueError as e:
                raise _Invalid([{"path": "", "message": "Model {!r}: {}".format(m.name, e)}]) from None
    try:
        if args.all and args.output:
            if os.path.exists(args.output) and not os.path.isdir(args.output):
                raise _Invalid([{"path": "", "message": "{} is a file; with --all, -o names a folder.".format(args.output)}])
            os.makedirs(args.output, exist_ok=True)
            used: set = set()
            for i, (m, doc) in enumerate(docs):
                target = os.path.join(args.output, _file_name(m.id, i, used))
                with open(target, "w", encoding="utf-8", newline="\n") as f:
                    f.write(dumps(doc))
                out.write("{}\t{}\n".format(target, m.name))
            return EXIT_OK
        if args.all:
            listed = [{"id": m.id, "name": m.name, "document": d} for m, d in docs]
            text = json.dumps(listed, ensure_ascii=False) + "\n"
        else:
            text = dumps(docs[0][1])
        if args.output:
            with open(args.output, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
        else:
            out.write(text)
    except OSError as e:
        raise _Invalid([{"path": "", "message": "Cannot write {}: {}".format(e.filename or args.output, e.strerror or e)}]) from None
    return EXIT_OK


def _cmd_schema(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

    try:
        schema = cslope.schema(args.name) if args.name else cslope.schema()
    except ValueError as e:
        err.write("{}\n".format(e))
        return EXIT_INVALID
    json.dump(schema, out, ensure_ascii=False, indent=2)
    out.write("\n")
    return EXIT_OK


def _cmd_info(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

    out.write("cslope {}\n".format(cslope.__version__))
    out.write("Engine build: {}\n".format(cslope.ENGINE_BUILD))
    out.write("Schema version: {}\n".format(cslope.SCHEMA_VERSION))
    out.write("Schemas: {}\n".format(", ".join(cslope.SCHEMA_NAMES)))
    out.write("Python: {}\n".format(sys.version.split()[0]))
    return EXIT_OK


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cslope",
        description="Slope stability analysis with the cSlope engine.",
        epilog="Exit status: 0 done, 1 the analysis failed, 2 the input is not valid.",
    )
    sub = p.add_subparsers(dest="command", metavar="command")
    sub.required = True
    a = sub.add_parser(
        "analyse",
        aliases=["analyze"],
        help="analyze a document or the models of a project file and print the summary",
        description="Analyze an analysis document, or models of a project file (.cslp) as the app runs them "
        "(without --model or --all, the active model). With --write the results are saved to the project, each "
        "with the hash of its model's input; a model whose input changed since its saved result keeps none.",
    )
    a.add_argument("document", help="an analysis document (JSON) or a project file (.cslp)")
    pw = a.add_mutually_exclusive_group()
    pw.add_argument("--model", metavar="NAME", help="a project: the model of this name (or id)")
    pw.add_argument("--all", action="store_true", help="a project: every model")
    a.add_argument("--write", action="store_true", help="a project: save the results to it")
    a.add_argument("--json", action="store_true", help="print the summary and the full result as JSON")
    a.add_argument("--threads", type=int, default=None, metavar="N", help="threads (default: every core)")
    a.set_defaults(run=_cmd_analyse)
    v = sub.add_parser("validate", help="check a document and list its issues")
    v.add_argument("document", help="an analysis document (JSON)")
    v.set_defaults(run=_cmd_validate)
    e = sub.add_parser(
        "export",
        help="write a model of a project file (.cslp) as an analysis document",
        description="Write a model of a project file (.cslp) as an analysis document: the engine's definition "
        "as the app makes it, in the model's own orientation, with the model's options. Without --model or "
        "--all, the active model. A project saved by an earlier cSlope is refused: open it in the app and save it.",
    )
    e.add_argument("project", help="a project file (.cslp)")
    which = e.add_mutually_exclusive_group()
    which.add_argument("--model", metavar="NAME", help="the model of this name (or id)")
    which.add_argument("--all", action="store_true", help="every model: a JSON list of {id, name, document}, or with -o a folder of <model id>.json files")
    e.add_argument("-o", "--output", metavar="PATH", help="write to this file (with --all: folder) instead of printing")
    e.set_defaults(run=_cmd_export)
    s = sub.add_parser("schema", help="print a JSON schema (cslope info lists the names)")
    s.add_argument("name", nargs="?", help="the schema's name (default: analysis-document)")
    s.set_defaults(run=_cmd_schema)
    i = sub.add_parser("info", help="print the versions")
    i.set_defaults(run=_cmd_info)
    return p


def main(argv: Optional[Sequence[str]] = None, out: Optional[TextIO] = None, err: Optional[TextIO] = None) -> int:
    """Run the command with ``argv`` (default: the command line); returns the
    exit status."""
    out = out if out is not None else _utf8(sys.stdout)
    err = err if err is not None else _utf8(sys.stderr)
    parser = _parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as e:  # argparse: --help (0) or a usage error (2)
        return int(e.code or 0)
    if getattr(args, "threads", None) is not None and args.threads < 1:
        err.write("--threads must be 1 or more\n")
        return EXIT_INVALID
    try:
        return args.run(args, out, err)
    except _Invalid as e:
        _print_issues(e.issues, err)
        return EXIT_INVALID
    except BrokenPipeError:  # the reader stopped early (| head): not an error
        try:  # and Python must not fail flushing stdout at exit
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, sys.stdout.fileno())
        except (OSError, ValueError, io.UnsupportedOperation):  # pragma: no cover
            pass
        return EXIT_OK


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
