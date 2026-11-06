"""The ``cslope`` command: analyze, validate and describe analysis documents.

    cslope analyse slope.json [--json] [--threads N]
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


def _cmd_analyse(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

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


def export_document(model: Dict[str, Any]) -> Dict[str, Any]:
    """The analysis document of a model of a project file (its
    ``model.json`` as a dict): the engine's definition as the app makes it,
    in the model's own orientation, and the model's options as the app runs
    them (absent: the app's defaults, which ``analyse`` takes anyway).

    The project's ``inputHash`` (docs/file-format.md, section 5) is the hash
    of the definition in canonical orientation (sliding towards +x), so for
    a model facing left it is not the hash of this document's definition;
    ``cslope.to_canonical`` turns it."""
    import cslope

    from .build import DOCUMENT_FORMAT, DOCUMENT_FORMAT_VERSION

    doc: Dict[str, Any] = {
        "format": DOCUMENT_FORMAT,
        "formatVersion": DOCUMENT_FORMAT_VERSION,
        "definition": cslope.model_to_definition(model),
    }
    if isinstance(model.get("options"), dict):
        doc["options"] = model["options"]
    return doc


def _open_project(path: str) -> Any:
    from . import project

    try:
        p = project.read(path)
    except OSError as e:
        raise _Invalid([{"path": "", "message": "Cannot read {}: {}".format(path, e.strerror or e)}]) from None
    except ValueError as e:
        raise _Invalid([{"path": "", "message": "{}: {}".format(path, e)}]) from None
    again = "open it in the cSlope app and save it, then export the saved file"
    if p.layout != "cslp":
        p.close()
        raise _Invalid([{"path": "", "message": "{} is a project file of an earlier cSlope version; {}.".format(path, again)}])
    if p.version < PROJECT_SCHEMA_VERSION:
        p.close()
        raise _Invalid(
            [{"path": "", "message": "{} was saved by an earlier cSlope (project schema version {}); {}.".format(path, p.version, again)}]
        )
    if p.version > PROJECT_SCHEMA_VERSION:
        p.close()
        raise _Invalid(
            [{"path": "", "message": "{} was saved by a newer cSlope (project schema version {}); update cslope to export it.".format(path, p.version)}]
        )
    return p


def _cmd_export(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    from .build import dumps

    with _open_project(args.project) as p:
        if args.all:
            models = list(p.models)
        elif args.model is not None:
            models = [m for m in p.models if m.name == args.model] or [m for m in p.models if m.id == args.model]
            if not models:
                names = ", ".join(repr(m.name) for m in p.models)
                raise _Invalid([{"path": "", "message": "No model named {!r} in {} (its models: {}).".format(args.model, args.project, names)}])
            if len(models) > 1:
                raise _Invalid(
                    [{"path": "", "message": "{} models are named {!r}; give the id instead ({}).".format(len(models), args.model, ", ".join(m.id for m in models))}]
                )
        else:
            models = [p.active_model]
        docs = []
        for m in models:
            try:
                docs.append((m, export_document(m.data)))
            except ValueError as e:
                raise _Invalid([{"path": "", "message": "Model {!r}: {}".format(m.name, e)}]) from None
    if args.all and args.output:
        os.makedirs(args.output, exist_ok=True)
        for m, doc in docs:
            target = os.path.join(args.output, m.id + ".json")
            with open(target, "w", encoding="utf-8", newline="\n") as f:
                f.write(dumps(doc))
            out.write("{}\t{}\n".format(target, m.name))
        return EXIT_OK
    text = dumps(docs[0][1]) if not args.all else json.dumps([d for _, d in docs], ensure_ascii=False) + "\n"
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    else:
        out.write(text)
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
    a = sub.add_parser("analyse", aliases=["analyze"], help="analyze a document and print the summary")
    a.add_argument("document", help="an analysis document (JSON)")
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
    which.add_argument("--all", action="store_true", help="every model: a JSON list, or with -o a folder of <model id>.json files")
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
