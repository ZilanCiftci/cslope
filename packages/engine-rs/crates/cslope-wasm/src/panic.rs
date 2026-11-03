//! Panics (ARCHITECTURE.md §3.5): the wasm-release profile aborts, so a panic
//! traps (`WebAssembly.RuntimeError: unreachable`). The hook first writes the
//! message and location to `console.error`, the only trace of what failed;
//! the facade then marks the instance as broken.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(message: &str);
}

/// Installs the hook (once, from the module's start function).
pub fn install_hook() {
    #[cfg(target_arch = "wasm32")]
    std::panic::set_hook(Box::new(|info| {
        console_error(&format!("cSlope engine panicked: {info}"));
    }));
}

/// Panics on purpose, for the facade's test of the trap handling (testing
/// build only).
#[cfg(feature = "testing")]
#[wasm_bindgen]
pub fn engine_panic_for_test() {
    panic!("engine_panic_for_test");
}
