//! The clock in WebAssembly (ARCHITECTURE.md §2.2, §3.5): `performance.now()`
//! read through `Reflect` on the global object, which works in a window, a
//! worker and Node. `std::time::Instant` panics on wasm32-unknown-unknown,
//! and the engine never reads time itself: the FE time limits get a clock
//! from `RunCtx`. This is the WebAssembly one; `api::ctx::Clock` is
//! implemented for it when the FE ports add that trait.

use js_sys::{Function, Reflect};
use wasm_bindgen::{JsCast, JsValue};

/// `performance.now()`, or `Date.now()` where there is no `performance`.
pub struct WasmClock {
    now: Function,
    this: JsValue,
}

impl WasmClock {
    pub fn new() -> Self {
        let global: JsValue = js_sys::global().into();
        if let Ok(perf) = Reflect::get(&global, &JsValue::from_str("performance")) {
            if let Ok(now) = Reflect::get(&perf, &JsValue::from_str("now")) {
                if let Ok(now) = now.dyn_into::<Function>() {
                    return WasmClock { now, this: perf };
                }
            }
        }
        let date = Reflect::get(&global, &JsValue::from_str("Date")).unwrap_or(JsValue::UNDEFINED);
        let now = Reflect::get(&date, &JsValue::from_str("now"))
            .ok()
            .and_then(|f| f.dyn_into::<Function>().ok())
            .expect("the global object has neither performance.now nor Date.now");
        WasmClock { now, this: date }
    }

    /// Milliseconds since an arbitrary origin.
    pub fn now_ms(&self) -> f64 {
        self.now
            .call0(&self.this)
            .ok()
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN)
    }
}

impl Default for WasmClock {
    fn default() -> Self {
        Self::new()
    }
}
