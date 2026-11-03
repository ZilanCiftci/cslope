//! `Math.*` with JavaScript semantics.
//!
//! The transcendental functions are thin wrappers over std (calling std
//! directly is equally fine). Their last bits can differ from V8's; that is
//! accepted (PORTING.md, tolerance policy). What matters here are the
//! JavaScript rules that change logic: `Math.round`, `Math.max`/`min` with
//! NaN and -0, `**` edge cases.
#![allow(clippy::disallowed_methods)]

pub fn sin(x: f64) -> f64 {
    x.sin()
}
pub fn cos(x: f64) -> f64 {
    x.cos()
}
pub fn tan(x: f64) -> f64 {
    x.tan()
}
pub fn asin(x: f64) -> f64 {
    x.asin()
}
pub fn acos(x: f64) -> f64 {
    x.acos()
}
pub fn atan(x: f64) -> f64 {
    x.atan()
}
pub fn atan2(y: f64, x: f64) -> f64 {
    y.atan2(x)
}
pub fn exp(x: f64) -> f64 {
    x.exp()
}
pub fn log(x: f64) -> f64 {
    x.ln()
}
pub fn log10(x: f64) -> f64 {
    x.log10()
}
pub fn sinh(x: f64) -> f64 {
    x.sinh()
}
pub fn cosh(x: f64) -> f64 {
    x.cosh()
}
pub fn tanh(x: f64) -> f64 {
    x.tanh()
}
pub fn cbrt(x: f64) -> f64 {
    x.cbrt()
}

/// `x ** y` and `Math.pow(x, y)`. Always use this, never `x * x` or `powi`
/// (fdlibm's `pow(x, 2)` is not always `x * x`). JavaScript differs from
/// IEEE `pow` only for `(±1) ** ±Infinity` and `1 ** NaN`, which are NaN.
pub fn pow(x: f64, y: f64) -> f64 {
    if y.is_nan() || (x.abs() == 1.0 && y.is_infinite()) {
        return f64::NAN;
    }
    x.powf(y)
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
        [a, b] => a.hypot(*b),
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
