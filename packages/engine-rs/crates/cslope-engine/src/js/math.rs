//! `Math.*` with JavaScript semantics, the same bits on every platform.
//!
//! The transcendental functions call the `libm` crate (pure Rust), never
//! std's `f64` methods: natively those call the platform's C library, which
//! rounds differently on Linux (glibc), macOS and Windows, and a search
//! amplifies a last-bit difference into a different factor of safety
//! (issue #61: Talbingo Dam gave 1.950794 on macOS and Windows, 1.950740 in
//! the app). In WebAssembly std calls the Rust toolchain's own copy of the
//! same libm, so routing through the crate gives native results that equal
//! the WebAssembly engine's bit for bit (`hypot` is the toolchain's newer,
//! correctly rounded one, js/hypot.rs). clippy.toml bans the std methods.
//!
//! Their last bits can still differ from V8's; that is accepted (PORTING.md,
//! tolerance policy). The other functions here are the JavaScript rules that
//! change logic: `Math.round`, `Math.max`/`min` with NaN and -0, `**` edge
//! cases.

pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}
pub fn tan(x: f64) -> f64 {
    libm::tan(x)
}
pub fn asin(x: f64) -> f64 {
    libm::asin(x)
}
pub fn acos(x: f64) -> f64 {
    libm::acos(x)
}
pub fn atan(x: f64) -> f64 {
    libm::atan(x)
}
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}
pub fn log(x: f64) -> f64 {
    libm::log(x)
}

/// `x ** y` and `Math.pow(x, y)`. Always use this, never `x * x` or `powi`
/// (fdlibm's `pow(x, 2)` is not always `x * x`). JavaScript differs from
/// IEEE `pow` only for `(±1) ** ±Infinity` and `1 ** NaN`, which are NaN.
pub fn pow(x: f64, y: f64) -> f64 {
    if y.is_nan() || (x.abs() == 1.0 && y.is_infinite()) {
        return f64::NAN;
    }
    libm::pow(x, y)
}

/// `Math.hypot(a, b, …)`: Infinity if any argument is ±Infinity, else NaN if
/// any is NaN.
pub fn hypot(values: &[f64]) -> f64 {
    if values.iter().any(|v| v.is_infinite()) {
        return f64::INFINITY;
    }
    if values.iter().any(|v| v.is_nan()) {
        return f64::NAN;
    }
    match values {
        [] => 0.0,
        [a] => a.abs(),
        [a, b] => super::hypot::hypot(*a, *b),
        _ => values.iter().map(|v| v * v).fold(0.0, |s, v| s + v).sqrt(),
    }
}

/// `Math.max(a, b)`: NaN if either is NaN; +0 over -0.
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == b {
        // only differs for ±0: +0 wins
        return if a.is_sign_negative() { b } else { a };
    }
    if a > b {
        a
    } else {
        b
    }
}

/// `Math.min(a, b)`: NaN if either is NaN; -0 over +0.
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == b {
        return if a.is_sign_negative() { a } else { b };
    }
    if a < b {
        a
    } else {
        b
    }
}

/// `Math.max(...xs)`: -Infinity for an empty list.
pub fn max_of(xs: &[f64]) -> f64 {
    xs.iter().fold(f64::NEG_INFINITY, |m, &x| max(m, x))
}

/// `Math.min(...xs)`: +Infinity for an empty list.
pub fn min_of(xs: &[f64]) -> f64 {
    xs.iter().fold(f64::INFINITY, |m, &x| min(m, x))
}

/// `Math.round`: halves round toward +Infinity; -0 and values in [-0.5, -0)
/// give -0; 0.49999999999999994 gives 0.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    if x > 0.0 && x < 0.5 {
        return 0.0;
    }
    if (-0.5..0.0).contains(&x) {
        return -0.0;
    }
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `Math.sign`.
pub fn sign(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 {
        x
    } else if x > 0.0 {
        1.0
    } else {
        -1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_semantics() {
        assert!(max(f64::NAN, 1.0).is_nan());
        assert!(max(-0.0, 0.0).is_sign_positive());
        assert!(max(0.0, -0.0).is_sign_positive());
        assert!(min(0.0, -0.0).is_sign_negative());
        assert_eq!(max_of(&[]), f64::NEG_INFINITY);
        assert_eq!(min_of(&[]), f64::INFINITY);
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert!(round(-0.4).is_sign_negative());
        assert_eq!(round(0.499_999_999_999_999_94), 0.0);
        assert_eq!(round(4_503_599_627_370_495.5), 4_503_599_627_370_496.0);
        assert!(pow(1.0, f64::INFINITY).is_nan());
        assert_eq!(pow(f64::NAN, 0.0), 1.0);
        assert_eq!(hypot(&[f64::NAN, f64::INFINITY]), f64::INFINITY);
        assert!(sign(-0.0).is_sign_negative());
    }
}
