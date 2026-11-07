"""Open, change and save cSlope project files (.cslp).

A ``.cslp`` file is a ZIP archive (the specification is docs/file-format.md
in the repository)::

    manifest.json                  the format and its version, who wrote the file and when
    project.json                   schema version, the models' order, the active model, units
    models/<id>/model.json         one model, without the outcome of its run
    models/<id>/result.json        the outcome of its run (optional), with the hash of its input
    models/<id>/backgrounds.json   the drawings placed under it (optional)
    assets/index.json              the attachments (optional)
    assets/<id>.<ext>              the attachments themselves
    thumbnail.png                  a small picture of the active model's result (optional)

``open(path)`` reads one with the engine's reader (the crate cslope-project):
each model's dict is the model as the app holds it after opening the file
(missing members filled, out-of-range values clamped, as the app does), in
the app's JSON shape (camelCase keys). ``Project.save(path)`` writes what
the app would write, so the app opens it as it was saved.

    >>> from cslope import project
    >>> p = project.open("slope.cslp")  # doctest: +SKIP
    >>> m = p.model_named("Section A")  # doctest: +SKIP
    >>> m.data["materials"][0]["model"]["cohesion"] = 12  # doctest: +SKIP
    >>> m.result_is_current  # doctest: +SKIP
    False
    >>> p.save("slope.cslp")  # doctest: +SKIP

The reader is strict, unlike the app's: a file the app saved with this
schema version opens; a file of an earlier version (a JSON project, the
first .cslp layout, an older schema) is refused with a message to open it
in the app and save it (the app migrates it), a newer one with a message to
update; a member or entry the format does not define is an error naming
it, never carried over. A model dict changed in Python is checked the same
way when the project is saved.

Results: a result belongs to the input it was computed for (its
``inputHash``). A model whose input changed since its result keeps no
result when the project is saved, and the project then drops its
thumbnail, unless the model was run again (``Model.set_result``;
``cslope analyse site.cslp --write`` does it for you).
"""

from __future__ import annotations

import builtins
import hashlib
import os
import warnings
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union

from . import _native

__all__ = [
    "FORMAT",
    "FORMAT_VERSION",
    "SCHEMA_VERSION",
    "Asset",
    "Model",
    "Placement",
    "Project",
    "open",
    "read",
]

#: The manifest's ``format``.
FORMAT = "cslope-project"
#: The layout this package reads and writes (the app's ``CSLP_FORMAT_VERSION``).
FORMAT_VERSION: int = _native.PROJECT_FORMAT_VERSION
#: The project schema version it reads and writes (the app's ``PROJECT_FILE_VERSION``).
SCHEMA_VERSION: int = _native.PROJECT_SCHEMA_VERSION

_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tif",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "image/vnd.dwg": "dwg",
    "image/vnd.dxf": "dxf",
}


@dataclass
class Asset:
    """An attachment (an entry of ``assets/index.json``)."""

    id: str
    mime: str
    original_name: str
    added_at: str
    data: bytes = field(repr=False, default=b"")

    @property
    def path(self) -> str:
        return "assets/{}.{}".format(self.id, _EXTENSIONS.get(self.mime.lower(), "bin"))

    @property
    def bytes(self) -> int:
        return len(self.data)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


@dataclass
class Model:
    """One model: its ``model.json`` as a dict, its saved result and its drawings."""

    id: str
    #: ``models/<id>/model.json`` as the app holds it after opening the file.
    data: Dict[str, Any]
    #: ``models/<id>/result.json``: ``runState``, ``result``, ``errorMessage``,
    #: ``inputHash`` and ``engine``; None without a saved outcome.
    result: Optional[Dict[str, Any]] = None
    #: ``models/<id>/backgrounds.json`` (the drawings placed, validated as the app reads them).
    backgrounds: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def name(self) -> str:
        return str(self.data.get("name", ""))

    @property
    def min_fos(self) -> Optional[float]:
        """The factor of safety of the saved result, or None."""
        r = self.result.get("result") if self.result else None
        return float(r["minFOS"]) if isinstance(r, dict) and "minFOS" in r else None

    @property
    def input_hash(self) -> str:
        """The hash of the model's analysis input as it is now (docs/file-format.md section 5)."""
        return _native.input_hash_of(dict(self.data, id=self.id))

    @property
    def result_is_current(self) -> bool:
        """Whether there is a saved result and it was computed for the model's input as it is now.
        A result that is not is dropped when the project is saved."""
        return bool(self.result) and self.result.get("inputHash") == self.input_hash

    def set_result(self, result: Dict[str, Any]) -> None:
        """Keep the result of a run of the model as it is now (an ``AnalysisResult`` in
        the model's coordinates, as ``cslope.analyse`` gives it), with its input hash."""
        self.result = _native.saved_result(dict(self.data, id=self.id), result=result)

    def set_error(self, message: str) -> None:
        """Keep a failed run of the model as it is now."""
        self.result = _native.saved_result(dict(self.data, id=self.id), error=message)


@dataclass
class Placement:
    """A drawing placed under a model (an entry of ``backgrounds.json``).

    The drawing's own coordinates (``source``: pixels of an image, points of a
    PDF page, origin at the top left, y downwards; a DWG or DXF drawing's
    model space coordinates with y turned downwards, ``(x, -y)``) map to the
    model's (m, y upwards) by the affine ``transform`` ``(a, b, c, d, e, f)``:
    ``x = a*u + c*v + e``, ``y = b*u + d*v + f``.
    """

    id: str
    asset_id: str
    transform: Tuple[float, float, float, float, float, float]
    #: ``mode`` ("points", "axes", "scale" or "drawing") and its inputs.
    calibration: Dict[str, Any]
    opacity: float = 1.0
    visible: bool = True
    order: float = 0
    #: The PDF page (1-based), or None (the first page).
    page: Optional[int] = None
    #: The part of the page shown, ``(x0, y0, x1, y1)`` in source units, or None (the whole page).
    crop: Optional[Tuple[float, float, float, float]] = None
    name: Optional[str] = None
    show_in_results: bool = False
    #: Locked on the canvas (the model's ``locks.backgrounds``).
    locked: bool = False
    #: A DWG or DXF drawing: the names of its layers not shown.
    hidden_layers: Tuple[str, ...] = ()

    def to_model(self, u: float, v: float) -> Tuple[float, float]:
        """The model point (m) of a point of the drawing."""
        a, b, c, d, e, f = self.transform
        return (a * u + c * v + e, b * u + d * v + f)


@dataclass
class Project:
    """A project file opened (``open``)."""

    #: ``manifest.json``.
    manifest: Dict[str, Any]
    active_model_id: str
    models: List[Model]
    assets: List[Asset]
    #: ``thumbnail.png``'s bytes, or None.
    thumbnail_png: Optional[bytes] = field(default=None, repr=False)
    #: The project schema version (``project.json`` ``version``).
    version: int = SCHEMA_VERSION
    units: str = "SI"
    #: The layout read; only "cslp" (this one) is read.
    layout: str = "cslp"

    def model(self, model_id: str) -> Model:
        for m in self.models:
            if m.id == model_id:
                return m
        raise KeyError(model_id)

    def model_named(self, name: str) -> Model:
        """The model of this name (an error when there are none or several)."""
        found = [m for m in self.models if m.name == name]
        if len(found) != 1:
            raise KeyError("{} models are named {!r}".format(len(found), name))
        return found[0]

    @property
    def active_model(self) -> Model:
        return self.model(self.active_model_id)

    def asset(self, asset_id: str) -> Asset:
        for a in self.assets:
            if a.id == asset_id:
                return a
        raise KeyError(asset_id)

    def read_asset(self, asset_id: str) -> bytes:
        """An attachment's bytes (checked against the index's SHA-256 when the file was opened)."""
        return self.asset(asset_id).data

    def thumbnail(self) -> Optional[bytes]:
        """``thumbnail.png``, or None without one."""
        return self.thumbnail_png

    def placements(self, model: Union[Model, str]) -> List[Placement]:
        """The drawings placed under a model, in drawing order (as the app reads
        them: an entry of the first form is converted to the affine transform)."""
        m = self.model(model) if isinstance(model, str) else model
        locks = m.data.get("locks") or {}
        locked = set(locks.get("backgrounds") or [])
        out = []
        for b in m.backgrounds:
            t = b["transform"]
            crop = b.get("crop")
            out.append(
                Placement(
                    id=b["id"],
                    asset_id=b["assetId"],
                    transform=tuple(float(t[k]) for k in "abcdef"),  # type: ignore[arg-type]
                    calibration=b["calibration"],
                    opacity=float(b["opacity"]),
                    visible=bool(b["visible"]),
                    order=b["order"],
                    page=int(b["page"]) if b.get("page") is not None else None,
                    crop=(crop["x0"], crop["y0"], crop["x1"], crop["y1"]) if crop else None,
                    name=b.get("name"),
                    show_in_results=b.get("showInResults") is True,
                    locked=b["id"] in locked,
                    hidden_layers=tuple(b.get("hiddenLayers") or ()),
                )
            )
        return sorted(out, key=lambda p: p.order)

    def save(self, path: Union[str, "os.PathLike[str]"]) -> Dict[str, Any]:
        """Write the project to ``path`` (atomically: a temporary file renamed
        over it), as the app writes it, after the save policy: a model whose
        input changed since its result keeps no result, and then the
        thumbnail goes too. Returns ``{"droppedResults": [model ids],
        "droppedThumbnail": bool}``; the project in memory follows."""
        from . import __version__

        doc = {
            "manifest": self.manifest,
            "activeModelId": self.active_model_id,
            "models": [{"id": m.id, "model": m.data, "result": m.result, "backgrounds": m.backgrounds} for m in self.models],
            "assets": [{"id": a.id, "mime": a.mime, "originalName": a.original_name, "addedAt": a.added_at} for a in self.assets],
        }
        report = _native.project_write(
            doc,
            {a.id: a.data for a in self.assets},
            self.thumbnail_png,
            os.fspath(path),
            __version__,
            "cslope {} (Python)".format(__version__),
        )
        self.manifest = report["manifest"]
        for model_id in report["droppedResults"]:
            self.model(model_id).result = None
        if report["droppedThumbnail"]:
            self.thumbnail_png = None
        return {"droppedResults": list(report["droppedResults"]), "droppedThumbnail": report["droppedThumbnail"]}

    def close(self) -> None:
        """Nothing to release (the file is read whole); kept for ``with``."""

    def __enter__(self) -> "Project":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def open(path: Union[str, "os.PathLike[str]"]) -> Project:  # noqa: A001 - the module's verb
    """Open a ``.cslp`` project file saved by the cSlope app (this schema version).

    Raises ``ValueError`` with a message for a file it does not read (an
    earlier or newer version, an unknown member, a damaged archive) and
    ``OSError`` when the file cannot be read."""
    doc, data, thumbnail = _native.project_read(os.fspath(path))
    models = [Model(m["id"], m["model"], m.get("result"), list(m.get("backgrounds") or [])) for m in doc["models"]]
    assets = [Asset(a["id"], a["mime"], a["originalName"], a["addedAt"], builtins.bytes(data[a["id"]])) for a in doc["assets"]]
    return Project(
        manifest=doc["manifest"],
        active_model_id=doc["activeModelId"],
        models=models,
        assets=assets,
        thumbnail_png=builtins.bytes(thumbnail) if thumbnail is not None else None,
    )


def read(path: Union[str, "os.PathLike[str]"]) -> Project:
    """Deprecated alias of ``open`` (``read`` read the files with the standard
    library, as they were; ``open`` reads them as the app does and refuses
    earlier versions: open those in the app and save them)."""
    warnings.warn("cslope.project.read is deprecated; use cslope.project.open", DeprecationWarning, stacklevel=2)
    return open(path)
