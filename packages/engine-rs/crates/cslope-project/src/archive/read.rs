//! Reading a `.cslp` archive with the reader's limits, and saving one to
//! a file atomically (feature `native`).

use crate::project::{EntrySource, Project, ProjectReadOptions};
use std::io::{Cursor, Read, Write};
use zip::{CompressionMethod, ZipArchive};

/// The largest project file (its drawings are stored in it).
pub const MAX_FILE_BYTES: u64 = 500 * 1024 * 1024;
/// The largest an entry may declare to unpack to.
pub const MAX_ENTRY_BYTES: u64 = 100 * 1024 * 1024;
/// The deflated entries together, but the attachments (the app's
/// `ZIP_LIMITS.totalBytes`).
pub const MAX_JSON_BYTES: u64 = 200 * 1024 * 1024;
/// The deflated attachments together (the app's `PROJECT_ZIP_LIMITS.assets`).
pub const MAX_ASSET_BYTES: u64 = 500 * 1024 * 1024;
/// The most entries an archive may have (a ZIP without ZIP64 holds at most
/// 65535, as the app reads them).
pub const MAX_ENTRIES: usize = 65_535;

fn megabytes(n: u64) -> String {
    format!("{} MB", n.div_ceil(1024 * 1024))
}

struct Archive {
    zip: ZipArchive<Cursor<Vec<u8>>>,
    names: Vec<String>,
}

impl EntrySource for Archive {
    fn names(&self) -> Vec<String> {
        self.names.clone()
    }

    fn read(&mut self, name: &str) -> Result<Vec<u8>, String> {
        let mut f = self
            .zip
            .by_name(name)
            .map_err(|e| format!("The project file is damaged ({name}: {e})."))?;
        let size = f.size();
        let mut out = Vec::with_capacity(size as usize);
        // never further than the declared size
        (&mut f)
            .take(size + 1)
            .read_to_end(&mut out)
            .map_err(|e| format!("The project file is damaged ({name}: {e})."))?;
        if out.len() as u64 > size {
            return Err(format!(
                "The project file is damaged (the entry {name} unpacks to more than its declared size)."
            ));
        }
        Ok(out)
    }
}

/// Open the bytes of a `.cslp` file (strictly, see [`crate::project`]).
pub fn read_project(bytes: Vec<u8>, options: &ProjectReadOptions) -> Result<Project, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("The file is too large to be a cSlope project.".into());
    }
    if bytes.len() < 4 || bytes[..4] != *b"PK\x03\x04" {
        let text = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
        let text = text.trim_start_matches('\u{feff}').trim_start();
        return Err(if text.starts_with('{') {
            "The file is a project of an earlier cSlope (a JSON project); open it in the cSlope app and save it.".into()
        } else {
            "The file is not a cSlope project (neither a .cslp archive nor a JSON project file)."
                .into()
        });
    }
    let mut zip = ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("The file is not a readable cSlope project: {e}"))?;
    if zip.has_overlapping_entries().unwrap_or(true) || zip.has_duplicate_names() {
        return Err("The file is not a readable cSlope project: entries overlap or repeat.".into());
    }
    if zip.len() > MAX_ENTRIES {
        return Err(format!(
            "The file is not a readable cSlope project: {} entries (at most {MAX_ENTRIES}).",
            zip.len()
        ));
    }
    let mut names = Vec::new();
    let mut json_total = 0u64;
    let mut asset_total = 0u64;
    for i in 0..zip.len() {
        let f = zip
            .by_index_raw(i)
            .map_err(|e| format!("The file is not a readable cSlope project: {e}"))?;
        let name = f
            .name()
            .map_err(|e| format!("The file is not a readable cSlope project: {e}"))?
            .into_owned();
        if f.encrypted() {
            return Err(format!("The project file's entry {name} is encrypted."));
        }
        if !matches!(
            f.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err(format!(
                "The project file's entry {name} is neither stored nor deflated."
            ));
        }
        if f.size() > MAX_ENTRY_BYTES {
            return Err(format!(
                "The archive's entry {name} is too large ({} unpacked; at most {}).",
                megabytes(f.size()),
                megabytes(MAX_ENTRY_BYTES)
            ));
        }
        // (declared sizes, before anything is unpacked; a stored entry is
        // the bytes the file holds)
        if f.compression() == CompressionMethod::Stored && f.size() != f.compressed_size() {
            return Err(format!(
                "The project file is damaged (the stored entry {name} declares another size than it holds)."
            ));
        }
        if f.compression() == CompressionMethod::Deflated {
            let is_asset = name.starts_with("assets/") && name != "assets/index.json";
            let (total, limit) = if is_asset {
                (&mut asset_total, MAX_ASSET_BYTES)
            } else {
                (&mut json_total, MAX_JSON_BYTES)
            };
            *total += f.size();
            if *total > limit {
                return Err(format!(
                    "The archive is too large (its entries unpack to more than {}).",
                    megabytes(limit)
                ));
            }
        }
        names.push(name);
    }
    let mut src = Archive { zip, names };
    Project::from_entries(&mut src, options)
}

/// Write `bytes` to `path` atomically (docs/file-format.md section 8):
/// to a temporary file next to it, flushed, then renamed over it.
pub fn save_atomically(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(std::path::Path::new("."));
    let name = path
        .file_name()
        .ok_or("No file name")?
        .to_string_lossy()
        .into_owned();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!("{name}.tmp-{}-{nanos:08x}", std::process::id()));
    let result = (|| {
        // a new file (never one that is there), with the permissions of the
        // file it replaces
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if let Ok(meta) = std::fs::metadata(path) {
            std::fs::set_permissions(&tmp, meta.permissions())?;
        }
        // (on Windows a reader such as a virus scanner may hold the target
        // for a moment: try again a few times)
        let mut tries = 0;
        loop {
            match std::fs::rename(&tmp, path) {
                Ok(()) => return Ok(()),
                Err(e) if cfg!(windows) && tries < 5 => {
                    let _ = e;
                    tries += 1;
                    std::thread::sleep(std::time::Duration::from_millis(100 * tries));
                }
                Err(e) => return Err(e),
            }
        }
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Cannot write {}: {e}", path.display()));
    }
    Ok(())
}
