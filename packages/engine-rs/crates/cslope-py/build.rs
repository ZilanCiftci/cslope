//! `cslope.ENGINE_BUILD`: the crate version and the git commit it was built
//! from ("0.1.0+abc1234def56"; "+unknown" outside a git checkout, e.g. from
//! an sdist). CSLOPE_ENGINE_COMMIT in the environment gives the commit
//! (the wheels workflow sets it: its build container may not run git).

use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=CSLOPE_ENGINE_COMMIT");
    let version = std::env::var("CARGO_PKG_VERSION").unwrap_or_default();
    let commit = std::env::var("CSLOPE_ENGINE_COMMIT")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            Command::new("git")
                .args(["rev-parse", "--short=12", "HEAD"])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "unknown".to_string());
    let commit: String = commit.chars().take(12).collect();
    println!("cargo:rustc-env=CSLOPE_ENGINE_BUILD={version}+{commit}");
}
