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

/// `Number.prototype.toPrecision(precision)` for `precision` in 1..=100: the
/// exact decimal value rounded to `precision` significant digits, ties to
/// the larger magnitude, in fixed notation for exponents −6..precision − 1
/// and exponential notation otherwise.
pub fn to_precision(x: f64, precision: usize) -> String {
    assert!(
        (1..=100).contains(&precision),
        "toPrecision precision out of range"
    );
    if !x.is_finite() {
        return to_string(x);
    }
    if x < 0.0 {
        return format!("-{}", to_precision(-x, precision));
    }
    let p = precision;
    let (digits, e) = if x == 0.0 {
        // (-0 prints as 0)
        ("0".repeat(p).into_bytes(), 0i32)
    } else {
        // Exact decimal expansion: a double has at most 767 significant digits.
        let exact = format!("{x:.1100e}");
        let (mantissa, exp) = exact.split_once('e').expect("LowerExp has an exponent");
        let mut e: i32 = exp.parse().expect("integer exponent");
        let all: Vec<u8> = mantissa.bytes().filter(|c| *c != b'.').collect();
        let mut kept: Vec<u8> = all[..p].to_vec();
        // round half up on the exact remainder
        if all[p] >= b'5' {
            let mut i = p;
            loop {
                if i == 0 {
                    kept.insert(0, b'1');
                    kept.truncate(p);
                    e += 1;
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
        (kept, e)
    };
    let m = String::from_utf8(digits).expect("ascii digits");
    let pi = p as i32;
    if e < -6 || e >= pi {
        let sign = if e >= 0 { '+' } else { '-' };
        if p == 1 {
            format!("{m}e{sign}{}", e.abs())
        } else {
            format!("{}.{}e{sign}{}", &m[..1], &m[1..], e.abs())
        }
    } else if e == pi - 1 {
        m
    } else if e >= 0 {
        let k = (e + 1) as usize;
        format!("{}.{}", &m[..k], &m[k..])
    } else {
        format!("0.{}{m}", "0".repeat((-(e + 1)) as usize))
    }
}

/// `Number(x.toPrecision(precision))`: x rounded to `precision` significant
/// digits as JavaScript rounds it (NaN and the infinities unchanged).
pub fn round_to_precision(x: f64, precision: usize) -> f64 {
    if !x.is_finite() {
        return x;
    }
    to_precision(x, precision)
        .parse()
        .expect("toPrecision gives a decimal number")
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
    #[test]
    fn to_precision_matches_v8() {
        // (x, toPrecision(7), (1), (3), (21)) from Node 22
        let cases: &[(f64, [&str; 4])] = &[
            (0.0, ["0.000000", "0", "0.00", "0.00000000000000000000"]),
            (-0.0, ["0.000000", "0", "0.00", "0.00000000000000000000"]),
            (1.0, ["1.000000", "1", "1.00", "1.00000000000000000000"]),
            (
                -1.5,
                ["-1.500000", "-2", "-1.50", "-1.50000000000000000000"],
            ),
            (
                0.1,
                ["0.1000000", "0.1", "0.100", "0.100000000000000005551"],
            ),
            (
                123456789.0,
                ["1.234568e+8", "1e+8", "1.23e+8", "123456789.000000000000"],
            ),
            (
                1.23456785,
                ["1.234568", "1", "1.23", "1.23456784999999991115"],
            ),
            (
                1.234565,
                ["1.234565", "1", "1.23", "1.23456499999999991246"],
            ),
            (
                0.00001234567,
                [
                    "0.00001234567",
                    "0.00001",
                    "0.0000123",
                    "0.0000123456700000000006723",
                ],
            ),
            (
                1.2345675e-7,
                [
                    "1.234568e-7",
                    "1e-7",
                    "1.23e-7",
                    "1.23456750000000011279e-7",
                ],
            ),
            (
                9.9999995,
                ["9.999999", "1e+1", "10.0", "9.99999949999999948602"],
            ),
            (
                99999995.0,
                ["1.000000e+8", "1e+8", "1.00e+8", "99999995.0000000000000"],
            ),
            (
                0.5,
                ["0.5000000", "0.5", "0.500", "0.500000000000000000000"],
            ),
            (
                2.5e-7,
                [
                    "2.500000e-7",
                    "2e-7",
                    "2.50e-7",
                    "2.49999999999999988687e-7",
                ],
            ),
            (
                1e21,
                [
                    "1.000000e+21",
                    "1e+21",
                    "1.00e+21",
                    "1.00000000000000000000e+21",
                ],
            ),
            (
                1.5e-300,
                [
                    "1.500000e-300",
                    "2e-300",
                    "1.50e-300",
                    "1.50000000000000012048e-300",
                ],
            ),
            (
                5e-324,
                [
                    "4.940656e-324",
                    "5e-324",
                    "4.94e-324",
                    "4.94065645841246544177e-324",
                ],
            ),
            (
                f64::MAX,
                [
                    "1.797693e+308",
                    "2e+308",
                    "1.80e+308",
                    "1.79769313486231570815e+308",
                ],
            ),
            (
                -123.4567890123,
                ["-123.4568", "-1e+2", "-123", "-123.456789012300006902"],
            ),
            (
                0.125,
                ["0.1250000", "0.1", "0.125", "0.125000000000000000000"],
            ),
            (
                1.0000005,
                ["1.000001", "1", "1.00", "1.00000050000000006989"],
            ),
            (
                1.00000049999,
                ["1.000000", "1", "1.00", "1.00000049999000006906"],
            ),
            (
                6.0221409e23,
                [
                    "6.022141e+23",
                    "6e+23",
                    "6.02e+23",
                    "6.02214090000000006226e+23",
                ],
            ),
            (
                7.14159265358979,
                ["7.141593", "7", "7.14", "7.14159265358978956328"],
            ),
            (
                -0.000123456749,
                [
                    "-0.0001234567",
                    "-0.0001",
                    "-0.000123",
                    "-0.000123456748999999993887",
                ],
            ),
            (
                1234567.5,
                ["1234568", "1e+6", "1.23e+6", "1234567.50000000000000"],
            ),
            (
                12345675.0,
                ["1.234568e+7", "1e+7", "1.23e+7", "12345675.0000000000000"],
            ),
            (
                9.999999e-7,
                [
                    "9.999999e-7",
                    "0.000001",
                    "0.00000100",
                    "9.99999900000000015515e-7",
                ],
            ),
            (f64::NAN, ["NaN", "NaN", "NaN", "NaN"]),
            (
                f64::INFINITY,
                ["Infinity", "Infinity", "Infinity", "Infinity"],
            ),
            (
                f64::NEG_INFINITY,
                ["-Infinity", "-Infinity", "-Infinity", "-Infinity"],
            ),
            (
                2.0000005,
                ["2.000001", "2", "2.00", "2.00000050000000006989"],
            ),
            (4.35, ["4.350000", "4", "4.35", "4.34999999999999964473"]),
            (
                0.0000145,
                [
                    "0.00001450000",
                    "0.00001",
                    "0.0000145",
                    "0.0000145000000000000000850",
                ],
            ),
        ];
        for (x, want) in cases {
            for (p, w) in [7, 1, 3, 21].iter().zip(want) {
                assert_eq!(to_precision(*x, *p), *w, "({x:e}).toPrecision({p})");
            }
        }
        assert_eq!(round_to_precision(1.23456785, 7), 1.234568);
        assert_eq!(round_to_precision(-0.000123456749, 7), -0.0001234567);
        assert!(round_to_precision(f64::NAN, 7).is_nan());
        assert_eq!(round_to_precision(f64::INFINITY, 7), f64::INFINITY);
    }
}
