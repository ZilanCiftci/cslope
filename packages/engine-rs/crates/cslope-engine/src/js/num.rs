//! Number-to-string conversions with JavaScript semantics. Every error
//! message or key that interpolates a number uses these, so that strings
//! match the TypeScript engine (e.g. `-0` prints as `"0"`, `1e21` in
//! exponent form).

/// The shortest round-trip decimal digits of a finite, positive `x` and the
/// ECMAScript exponent `n` (value = 0.d₁d₂… × 10ⁿ).
fn shortest_digits(x: f64) -> (String, i32) {
    let s = format!("{x:e}"); // shortest round-trip, e.g. "1.2345e-7"
    let (mantissa, exp) = s.split_once('e').expect("LowerExp has an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let e: i32 = exp.parse().expect("integer exponent");
    (digits, e + 1)
}

/// `Number.prototype.toString()` (radix 10), i.e. `${x}`.
pub fn to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == 0.0 {
        return "0".into();
    }
    if x.is_infinite() {
        return if x > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    if x < 0.0 {
        return format!("-{}", to_string(-x));
    }
    let (d, n) = shortest_digits(x);
    let k = d.len() as i32;
    if k <= n && n <= 21 {
        format!("{d}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &d[..n as usize], &d[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{d}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let sign = if e >= 0 { '+' } else { '-' };
        if k == 1 {
            format!("{d}e{sign}{}", e.abs())
        } else {
            format!("{}.{}e{sign}{}", &d[..1], &d[1..], e.abs())
        }
    }
}

/// `Number.prototype.toFixed(digits)` for `digits` in 0..=100: the exact
/// decimal value rounded to `digits` places, ties to the larger magnitude.
pub fn to_fixed(x: f64, digits: usize) -> String {
    assert!(digits <= 100, "toFixed digits out of range");
    if x.is_nan() {
        return "NaN".into();
    }
    if x.abs() >= 1e21 || x.is_infinite() {
        return to_string(x);
    }
    if x < 0.0 {
        return format!("-{}", to_fixed(-x, digits));
    }
    let x = if x == 0.0 { 0.0 } else { x }; // -0 prints as 0
                                            // Exact decimal expansion: a double has at most 1074 fractional digits.
    let exact = format!("{x:.1100}");
    let (int_part, frac_part) = exact.split_once('.').expect("fraction");
    let mut kept: Vec<u8> = int_part
        .bytes()
        .chain(frac_part.bytes().take(digits))
        .collect();
    let rest = &frac_part.as_bytes()[digits..];
    // round half up on the exact remainder
    if rest.first().is_some_and(|&c| c >= b'5') {
        let mut i = kept.len();
        loop {
            if i == 0 {
                kept.insert(0, b'1');
                break;
            }
            i -= 1;
            if kept[i] == b'9' {
                kept[i] = b'0';
            } else {
                kept[i] += 1;
                break;
            }
        }
    }
    let int_len = kept.len() - digits;
    let s = String::from_utf8(kept).expect("ascii digits");
    if digits == 0 {
        s
    } else {
        format!("{}.{}", &s[..int_len], &s[int_len..])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_string_matches_js() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (0.1, "0.1"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1.25e-7, "1.25e-7"),
            (0.1 + 0.2, "0.30000000000000004"),
            (f64::MAX, "1.7976931348623157e+308"),
            (5e-324, "5e-324"),
            (f64::INFINITY, "Infinity"),
            (f64::NAN, "NaN"),
        ];
        for (x, want) in cases {
            assert_eq!(to_string(*x), *want, "{x:e}");
        }
    }

    #[test]
    fn to_fixed_matches_js() {
        let cases: &[(f64, usize, &str)] = &[
            (1.005, 2, "1.00"), // 1.005 is 1.00499999999999989...
            (1.5, 0, "2"),
            (2.5, 0, "3"),
            (-2.5, 0, "-3"),
            (0.125, 2, "0.13"),
            (-0.0001, 2, "-0.00"),
            (-0.0, 2, "0.00"),
            (9.995, 2, "9.99"),
            (99.5, 0, "100"),
            (1e21, 2, "1e+21"),
            (123.456, 1, "123.5"),
            (0.5, 0, "1"),
        ];
        for (x, d, want) in cases {
            assert_eq!(to_fixed(*x, *d), *want, "{x}.toFixed({d})");
        }
    }
}
