"""Read cSlope project files (.cslp) without the engine.

A ``.cslp`` file is a ZIP archive (the specification is docs/file-format.md
in the repository)::

    manifest.json                  the format and its version, who wrote the file and when
    project.json                   schema version, the models' order, the active model, units
    models/<id>/model.json         one model, without the outcome of its run
    models/<id>/result.json        the outcome of its run (optional)
    models/<id>/backgrounds.json   its background images (optional)
    assets/index.json              the attachments (optional)
    assets/<id>.<ext>              the attachments themselves
    thumbnail.png                  a small picture of the active model's result (optional)

``read(path)`` opens one and gives the models as the dicts the files hold
(the app's JSON shapes, camelCase keys), as they are: nothing is validated
or migrated here, unlike in the app, which drops unknown fields and brings
older schema versions up to date. The attachments are read on demand.
Projects saved by earlier versions (a single JSON file, or the first
``.cslp`` layout with ``project.json`` and ``results.json`` at the root)
are read too.

    >>> from cslope import project
    >>> p = project.read("slope.cslp")  # doctest: +SKIP
    >>> [m.name for m in p.models]  # doctest: +SKIP
    >>> p.models[0].data["coordinates"]  # doctest: +SKIP
    >>> p.models[0].result["result"]["minFOS"]  # doctest: +SKIP

This module needs only the standard library (zipfile, json): it is usable
without the compiled engine, through ``cslope.project`` or on its own.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

__all__ = ["FORMAT", "FORMAT_VERSION", "Asset", "Model", "Project", "read"]

#: The manifest's ``format``.
FORMAT = "cslope-project"
#: The layout this reader knows; a file whose ``minReaderVersion`` is above it is refused.
FORMAT_VERSION = 1

#: The largest an archive's entry may unpack to, and all its entries together
#: (their declared sizes, checked before anything is read): the limits of the
#: app's reader.
MAX_ENTRY_BYTES = 100 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_MODEL_JSON = re.compile(r"^models/([A-Za-z0-9_-]+)/model\.json$")
_RUN_FIELDS = ("runState", "progress", "result", "errorMessage")


@dataclass
class Asset:
    """An entry of ``assets/index.json``."""

    id: str
    path: str
    mime: str
    bytes: int
    sha256: str
    original_name: str
    added_at: str


@dataclass
class Model:
    """One model: its ``model.json`` as a dict, and the outcome of its run."""

    id: str
    #: ``models/<id>/model.json`` (the app's ModelEntry without the run fields).
    data: Dict[str, Any]
    #: ``models/<id>/result.json``: ``runState``, ``result``, ``errorMessage``,
    #: ``inputHash`` and ``engine``; None without a saved outcome.
    result: Optional[Dict[str, Any]] = None
    #: ``models/<id>/backgrounds.json``.
    backgrounds: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def name(self) -> str:
        return str(self.data.get("name", ""))

    @property
    def min_fos(self) -> Optional[float]:
        """The factor of safety of the saved result, or None."""
        r = self.result.get("result") if self.result else None
        return float(r["minFOS"]) if isinstance(r, dict) and "minFOS" in r else None


@dataclass
class Project:
    """A project file opened."""

    #: ``manifest.json`` (empty for a JSON project of an earlier version).
    manifest: Dict[str, Any]
    #: The project schema version (``project.json`` ``version``).
    version: int
    active_model_id: str
    units: str
    models: List[Model]
    assets: List[Asset]
    #: "cslp" (this layout), "cslp-3file" (the first .cslp layout) or "json".
    layout: str
    _archive: Optional[zipfile.ZipFile] = field(default=None, repr=False)

    def model(self, model_id: str) -> Model:
        for m in self.models:
            if m.id == model_id:
                return m
        raise KeyError(model_id)

    @property
    def active_model(self) -> Model:
        return self.model(self.active_model_id)

    def asset(self, asset_id: str) -> Asset:
        for a in self.assets:
            if a.id == asset_id:
                return a
        raise KeyError(asset_id)

    def read_asset(self, asset_id: str) -> bytes:
        """An attachment's bytes, checked against the index's SHA-256."""
        a = self.asset(asset_id)
        if self._archive is None:
            raise KeyError(asset_id)
        data = _read_entry(self._archive, a.path)
        if hashlib.sha256(data).hexdigest() != a.sha256:
            raise ValueError(f"the attachment {a.original_name or a.path} does not match its hash")
        return data

    def thumbnail(self) -> Optional[bytes]:
        """``thumbnail.png``, or None without one."""
        if self._archive is not None and "thumbnail.png" in self._archive.namelist():
            return _read_entry(self._archive, "thumbnail.png")
        return None

    def close(self) -> None:
        if self._archive is not None:
            self._archive.close()
            self._archive = None

    def __enter__(self) -> "Project":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def read(path: Union[str, "os.PathLike[str]"]) -> Project:
    """Open a project file: a ``.cslp`` archive, or a JSON project of an earlier version."""
    if zipfile.is_zipfile(path):
        archive = zipfile.ZipFile(path)
        try:
            _check_sizes(archive)
            return _read_archive(archive)
        except BaseException:
            archive.close()
            raise
    with open(path, "rb") as f:
        text = f.read().decode("utf-8-sig")
    if not text.lstrip().startswith("{"):
        raise ValueError("not a cSlope project (neither a .cslp archive nor a JSON project file)")
    return _from_root(json.loads(text), {}, "json", None)


def _megabytes(n: int) -> str:
    return f"{-(-n // (1024 * 1024))} MB"


def _check_sizes(archive: zipfile.ZipFile) -> None:
    """Refuse an archive whose entries declare more than the limits."""
    total = 0
    for info in archive.infolist():
        if info.file_size > MAX_ENTRY_BYTES:
            raise ValueError(f"the archive's entry {info.filename} is too large ({_megabytes(info.file_size)} unpacked; at most {_megabytes(MAX_ENTRY_BYTES)})")
        total += info.file_size
        if total > MAX_TOTAL_BYTES:
            raise ValueError(f"the archive is too large (its entries unpack to more than {_megabytes(MAX_TOTAL_BYTES)})")


def _read_entry(archive: zipfile.ZipFile, name: str) -> bytes:
    """An entry's bytes, read no further than its declared size (within the limits)."""
    info = archive.getinfo(name)
    if info.file_size > MAX_ENTRY_BYTES:
        raise ValueError(f"the archive's entry {name} is too large ({_megabytes(info.file_size)} unpacked; at most {_megabytes(MAX_ENTRY_BYTES)})")
    with archive.open(info) as f:
        data = f.read(info.file_size + 1)
    if len(data) > info.file_size:
        raise ValueError(f"the archive's entry {name} unpacks to more than its declared size")
    return data


def _units(root: Dict[str, Any]) -> str:
    """The project's units: SI (the numbers of a project in other units cannot be read as they are)."""
    units = root.get("units", "SI")
    if units != "SI":
        raise ValueError(f"the project is in {units if isinstance(units, str) else 'unknown'} units; this reader reads SI projects only")
    return "SI"


def _json(archive: zipfile.ZipFile, name: str) -> Any:
    try:
        return json.loads(_read_entry(archive, name).decode("utf-8"))
    except ValueError as e:
        raise ValueError(f"the project's {name} is not valid JSON") from e


def _read_archive(archive: zipfile.ZipFile) -> Project:
    names = set(archive.namelist())
    if "manifest.json" not in names:
        raise ValueError("not a cSlope project (the archive has no manifest.json)")
    manifest = _json(archive, "manifest.json")
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise ValueError("not a cSlope project (its manifest names another format)")
    version = manifest.get("formatVersion")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise ValueError("the project's manifest.json is damaged (no valid formatVersion)")
    min_reader = manifest.get("minReaderVersion", version)
    if not isinstance(min_reader, int) or isinstance(min_reader, bool) or min_reader < 1:
        min_reader = version
    if min_reader > FORMAT_VERSION:
        generator = manifest.get("generator") or (f"cSlope {manifest['appVersion']}" if manifest.get("appVersion") else "a newer cSlope")
        raise ValueError(f"this project was saved by a newer cSlope ({generator}); update to open it")
    if "project.json" not in names:
        raise ValueError("the project file is damaged (the archive has no project.json)")
    project = _json(archive, "project.json")
    if not isinstance(project, dict):
        raise ValueError("the project file is damaged (project.json is not an object)")

    folders = sorted(m.group(1) for m in (_MODEL_JSON.match(n) for n in names) if m)
    if not folders:
        # The first layout: the models in project.json, their outcomes in results.json.
        if not isinstance(project.get("models"), list):
            raise ValueError("the project file is damaged (no models in project.json and no models/ folder)")
        results = _json(archive, "results.json") if "results.json" in names else None
        by_id = results.get("models") if isinstance(results, dict) and isinstance(results.get("models"), dict) else {}
        for m in project["models"]:
            if isinstance(m, dict):
                run = by_id.get(m.get("id"))
                for f in _RUN_FIELDS:
                    m.pop(f, None)
                if isinstance(run, dict):
                    m.update({f: run[f] for f in _RUN_FIELDS if f in run})
        return _from_root(project, manifest, "cslp-3file", archive)

    listed = [i for i in project.get("models", []) if isinstance(i, str) and _SAFE_ID.match(i)] if isinstance(project.get("models"), list) else []
    for i in listed:
        if f"models/{i}/model.json" not in names:
            raise ValueError(f"the project file is damaged (project.json names the model {i}, but models/{i}/model.json is missing)")
    ids = listed + [i for i in folders if i not in listed]
    models: List[Model] = []
    for i in ids:
        data = _json(archive, f"models/{i}/model.json")
        if not isinstance(data, dict):
            raise ValueError(f"the project file is damaged (models/{i}/model.json is not an object)")
        data["id"] = i
        for f in _RUN_FIELDS:
            data.pop(f, None)
        result = _json(archive, f"models/{i}/result.json") if f"models/{i}/result.json" in names else None
        if not isinstance(result, dict) or result.get("runState") not in ("done", "error"):
            result = None
        backgrounds = _json(archive, f"models/{i}/backgrounds.json") if f"models/{i}/backgrounds.json" in names else []
        models.append(Model(i, data, result, [b for b in backgrounds if isinstance(b, dict)] if isinstance(backgrounds, list) else []))

    assets: List[Asset] = []
    if "assets/index.json" in names:
        index = _json(archive, "assets/index.json")
        sizes = {info.filename: info.file_size for info in archive.infolist()}
        for item in index if isinstance(index, list) else []:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not _SAFE_ID.match(item["id"]):
                continue
            path = item.get("path")
            if not isinstance(path, str) or sizes.get(path) != item.get("bytes") or path != f"assets/{item['id']}.{path.rsplit('.', 1)[-1]}":
                continue
            if not isinstance(item.get("sha256"), str):
                continue
            assets.append(Asset(item["id"], path, str(item.get("mime", "application/octet-stream")), int(item["bytes"]), item["sha256"], str(item.get("originalName", "")), str(item.get("addedAt", ""))))

    return Project(
        manifest=manifest,
        version=int(project.get("version", 1)),
        active_model_id=str(project.get("activeModelId", ids[0])),
        units=_units(project),
        models=models,
        assets=assets,
        layout="cslp",
        _archive=archive,
    )


def _from_root(root: Dict[str, Any], manifest: Dict[str, Any], layout: str, archive: Optional[zipfile.ZipFile]) -> Project:
    """A project whose models are in one JSON object (a JSON project, or the first .cslp layout)."""
    raw = root.get("models")
    if not isinstance(raw, list) or not raw:
        raise ValueError("the file must include at least one model")
    models: List[Model] = []
    for m in raw:
        if not isinstance(m, dict) or not isinstance(m.get("id"), str):
            raise ValueError("a model entry is invalid")
        run = {f: m.pop(f) for f in _RUN_FIELDS if f in m}
        result = {"runState": run["runState"], "result": run.get("result"), "errorMessage": run.get("errorMessage")} if run.get("runState") in ("done", "error") else None
        models.append(Model(m["id"], m, result))
    version = root.get("version", 1)
    return Project(
        manifest=manifest,
        version=int(version) if isinstance(version, (int, float)) else 1,
        active_model_id=str(root.get("activeModelId", models[0].id)),
        units=_units(root),
        models=models,
        assets=[],
        layout=layout,
        _archive=archive,
    )
