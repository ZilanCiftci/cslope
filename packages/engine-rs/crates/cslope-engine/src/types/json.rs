//! JSON helpers for the API types (not a port of a TypeScript file): numbers
//! as JavaScript has them, with NaN and the infinities that plain JSON lacks.
//! A required number accepts a JSON number, `null` (what `JSON.stringify`
//! makes of NaN and ±Infinity) as NaN, and the strings "NaN", "Infinity",
//! "-Infinity" (the fixtures' encoding); used with `deserialize_with`.

use crate::error::EngineError;
use serde::de::{self, Deserialize, Deserializer, Visitor};
use serde::Serialize;
use serde_json::Value;
use std::fmt;

/// A number as JavaScript has it: a JSON number, `null` (what
/// `JSON.stringify` makes of NaN and ±Infinity) as NaN, or one of the
/// strings "NaN", "Infinity", "-Infinity" (the fixtures' encoding).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JsNum(pub f64);

impl<'de> Deserialize<'de> for JsNum {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = JsNum;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a number, null, \"NaN\", \"Infinity\" or \"-Infinity\"")
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<JsNum, E> {
                Ok(JsNum(v))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<JsNum, E> {
                Ok(JsNum(v as f64))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<JsNum, E> {
                Ok(JsNum(v as f64))
            }
            fn visit_unit<E: de::Error>(self) -> Result<JsNum, E> {
                Ok(JsNum(f64::NAN))
            }
            fn visit_none<E: de::Error>(self) -> Result<JsNum, E> {
                Ok(JsNum(f64::NAN))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<JsNum, E> {
                match v {
                    "NaN" => Ok(JsNum(f64::NAN)),
                    "Infinity" => Ok(JsNum(f64::INFINITY)),
                    "-Infinity" => Ok(JsNum(f64::NEG_INFINITY)),
                    _ => Err(E::invalid_value(de::Unexpected::Str(v), &self)),
                }
            }
        }
        d.deserialize_any(V)
    }
}

/// `deserialize_with` for a required number (see `JsNum`).
pub fn num<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    JsNum::deserialize(d).map(|n| n.0)
}

/// `deserialize_with` for an optional number: absent or `null` is `None`.
pub fn opt_num<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Option::<JsNum>::deserialize(d).map(|n| n.map(|n| n.0))
}

/// `default` for a required number of an input whose validation reports
/// it: missing is `undefined`, which every finiteness test rejects as NaN.
pub fn nan() -> f64 {
    f64::NAN
}

/// A tuple of N numbers (see `JsNum`).
struct JsTuple<const N: usize>([f64; N]);

impl<'de, const N: usize> Deserialize<'de> for JsTuple<N> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V<const N: usize>;
        impl<'de, const N: usize> Visitor<'de> for V<N> {
            type Value = JsTuple<N>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                write!(f, "a list of {N} numbers")
            }
            fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<JsTuple<N>, A::Error> {
                let mut out = [0.0; N];
                for (i, slot) in out.iter_mut().enumerate() {
                    let v: JsNum = seq
                        .next_element()?
                        .ok_or_else(|| de::Error::invalid_length(i, &self))?;
                    *slot = v.0;
                }
                if seq.next_element::<de::IgnoredAny>()?.is_some() {
                    return Err(de::Error::invalid_length(N + 1, &self));
                }
                Ok(JsTuple(out))
            }
        }
        d.deserialize_seq(V::<N>)
    }
}

/// `deserialize_with` for a list of fixed-size number tuples (points).
/// `null` reads as an empty list (validation reports it as too short, as
/// TypeScript does for a list that is not an array).
pub fn tuples<'de, D: Deserializer<'de>, const N: usize>(d: D) -> Result<Vec<[f64; N]>, D::Error> {
    let raw = Option::<Vec<JsTuple<N>>>::deserialize(d)?;
    Ok(raw.unwrap_or_default().into_iter().map(|p| p.0).collect())
}

/// `deserialize_with` for an optional list of tuples.
pub fn opt_tuples<'de, D: Deserializer<'de>, const N: usize>(
    d: D,
) -> Result<Option<Vec<[f64; N]>>, D::Error> {
    let raw = Option::<Vec<JsTuple<N>>>::deserialize(d)?;
    Ok(raw.map(|v| v.into_iter().map(|p| p.0).collect()))
}

/// `deserialize_with` for an optional field that may also be `null`
/// (`field?: T | null`): absent is `None`, `null` is `Some(None)`.
pub fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

/// Any value as a `serde_json::Value`, with NaN and ±Infinity kept as the
/// strings "NaN", "Infinity" and "-Infinity" (which [`JsNum`] reads back)
/// instead of `null`: for types that buffer their input before choosing a
/// variant (`MaterialModel`), so that a non-finite number from JavaScript
/// (serde-wasm-bindgen passes it as `f64`) reaches validation as itself.
pub struct JsJson(pub serde_json::Value);

impl<'de> Deserialize<'de> for JsJson {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde_json::{Map, Number, Value};
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = JsJson;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("any value")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<JsJson, E> {
                Ok(JsJson(Value::Bool(v)))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<JsJson, E> {
                Ok(JsJson(Value::Number(v.into())))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<JsJson, E> {
                Ok(JsJson(Value::Number(v.into())))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<JsJson, E> {
                Ok(JsJson(match Number::from_f64(v) {
                    Some(n) => Value::Number(n),
                    None if v.is_nan() => Value::String("NaN".into()),
                    None if v > 0.0 => Value::String("Infinity".into()),
                    None => Value::String("-Infinity".into()),
                }))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<JsJson, E> {
                Ok(JsJson(Value::String(v.into())))
            }
            fn visit_string<E: de::Error>(self, v: String) -> Result<JsJson, E> {
                Ok(JsJson(Value::String(v)))
            }
            fn visit_unit<E: de::Error>(self) -> Result<JsJson, E> {
                Ok(JsJson(Value::Null))
            }
            fn visit_none<E: de::Error>(self) -> Result<JsJson, E> {
                Ok(JsJson(Value::Null))
            }
            fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<JsJson, D::Error> {
                JsJson::deserialize(d)
            }
            fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<JsJson, A::Error> {
                let mut out = Vec::new();
                while let Some(JsJson(v)) = seq.next_element()? {
                    out.push(v);
                }
                Ok(JsJson(Value::Array(out)))
            }
            fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<JsJson, A::Error> {
                let mut out = Map::new();
                while let Some((k, JsJson(v))) = map.next_entry::<String, JsJson>()? {
                    out.insert(k, v);
                }
                Ok(JsJson(Value::Object(out)))
            }
        }
        d.deserialize_any(V)
    }
}

// ── Values as JavaScript reads them ─────────────────────────────
//
// For the inputs TypeScript checks itself (material models, analysis
// options, definition fields that may be `null` or of another type): the
// value is kept as JSON and read with JavaScript's rules. `None` is
// `undefined` (a missing field); the strings "NaN", "Infinity" and
// "-Infinity" are the non-finite numbers (`JsJson`'s encoding).

/// The number of a JavaScript `number` (`typeof v === "number"`).
pub fn js_number(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => match s.as_str() {
            "NaN" => Some(f64::NAN),
            "Infinity" => Some(f64::INFINITY),
            "-Infinity" => Some(f64::NEG_INFINITY),
            _ => None,
        },
        _ => None,
    }
}

/// `Number.isFinite(v)`: a finite number, no conversion.
pub fn js_is_finite(v: Option<&Value>) -> bool {
    js_number(v).is_some_and(f64::is_finite)
}

/// `isFinite(v)` (the global function): `ToNumber(v)` is finite.
pub fn js_global_is_finite(v: Option<&Value>) -> bool {
    js_to_number(v).is_finite()
}

/// JavaScript's white space and line terminators (`String.prototype.trim`).
fn js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// `ToNumber` of a string (StringToNumber).
fn string_to_number(s: &str) -> f64 {
    let t = s.trim_matches(js_space);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let radix = |digits: &str, r: u32| -> f64 {
        if digits.is_empty() {
            return f64::NAN;
        }
        let mut v = 0.0;
        for c in digits.chars() {
            match c.to_digit(r) {
                Some(d) => v = v * f64::from(r) + f64::from(d),
                None => return f64::NAN,
            }
        }
        v
    };
    let lower = t.to_ascii_lowercase();
    if let Some(d) = lower.strip_prefix("0x") {
        return radix(d, 16);
    }
    if let Some(d) = lower.strip_prefix("0o") {
        return radix(d, 8);
    }
    if let Some(d) = lower.strip_prefix("0b") {
        return radix(d, 2);
    }
    // StrDecimalLiteral: [+-] (digits [. digits] | . digits) [e [+-] digits]
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i - int_start;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let frac_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        digits += i - frac_start;
    }
    if digits == 0 {
        return f64::NAN;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let exp_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp_start {
            return f64::NAN;
        }
    }
    if i != b.len() {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// `ToNumber(v)`, as in a comparison or arithmetic (`undefined` is NaN,
/// `null` 0, an array its joined string).
pub fn js_to_number(v: Option<&Value>) -> f64 {
    if let Some(n) = js_number(v) {
        return n;
    }
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::String(s)) => string_to_number(s),
        Some(a @ Value::Array(_)) => string_to_number(&js_to_string(Some(a))),
        Some(_) => f64::NAN,
    }
}

/// `String(v)` (as a template literal formats it).
pub fn js_to_string(v: Option<&Value>) -> String {
    if let Some(n) = js_number(v) {
        return crate::js::num::to_string(n);
    }
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|e| match e {
                Value::Null => String::new(),
                e => js_to_string(Some(e)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(_) => "[object Object]".into(),
    }
}

/// Whether `v` is truthy.
pub fn js_truthy(v: Option<&Value>) -> bool {
    if let Some(n) = js_number(v) {
        return !(n == 0.0 || n.is_nan());
    }
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `v[key]` for a named field: the field of an object, `undefined` on any
/// other value (an array's elements and length are read with `js_array`),
/// and JavaScript's TypeError on `undefined` and `null`.
pub fn js_get<'a>(v: Option<&'a Value>, key: &str) -> Result<Option<&'a Value>, EngineError> {
    match v {
        None => Err(EngineError::type_error(format!(
            "Cannot read properties of undefined (reading '{key}')"
        ))),
        Some(Value::Null) => Err(EngineError::type_error(format!(
            "Cannot read properties of null (reading '{key}')"
        ))),
        Some(Value::Object(o)) => Ok(o.get(key)),
        Some(_) => Ok(None),
    }
}

/// The elements of `v` if it is an array (`Array.isArray`).
pub fn js_array(v: Option<&Value>) -> Option<&Vec<Value>> {
    match v {
        Some(Value::Array(a)) => Some(a),
        _ => None,
    }
}

/// `deserialize_with` for an optional number TypeScript checks with
/// `Number.isFinite` before it uses it (`v !== undefined && !isFinite(v)`):
/// absent is `None`; `null`, a string or any other value that is not a
/// number is `Some(NaN)`, which fails that check as the value itself does.
pub fn present_num<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    let v = JsJson::deserialize(d)?.0;
    Ok(Some(js_number(Some(&v)).unwrap_or(f64::NAN)))
}

/// `deserialize_with` for an optional number TypeScript uses without a
/// check, as `v ?? default` in arithmetic: absent and `null` are `None`,
/// another value `ToNumber` of it (`"1"` is 1).
pub fn opt_to_number<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    let v = JsJson::deserialize(d)?.0;
    Ok((!v.is_null()).then(|| js_to_number(Some(&v))))
}

/// `deserialize_with` for an optional flag TypeScript reads by truthiness:
/// absent is `None`, any other value (`null` too) whether it is truthy.
pub fn truthy<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
    let v = JsJson::deserialize(d)?.0;
    Ok(Some(js_truthy(Some(&v))))
}

/// `deserialize_with` for an optional flag TypeScript reads as
/// `flag ?? default` and then by truthiness: absent and `null` are `None`,
/// any other value whether it is truthy.
pub fn nullish_truthy<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
    let v = JsJson::deserialize(d)?.0;
    Ok(match v {
        Value::Null => None,
        v => Some(js_truthy(Some(&v))),
    })
}

/// `deserialize_with` for an optional field where `null` is a value
/// (`v !== undefined` in TypeScript): absent is `None`, anything present,
/// `null` included, is deserialized as `T` (with `T`'s own reading of
/// `null`).
pub fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

/// A value TypeScript compares with known strings: one of them (`T`), or
/// anything else, kept as it came (`null` included), so that the check that
/// rejects it gives TypeScript's message, or TypeScript's default applies.
#[derive(Debug, Clone, PartialEq)]
pub enum OrOther<T> {
    Known(T),
    Other(Value),
}

impl<T> OrOther<T> {
    /// The known value, if it is one.
    pub fn known(&self) -> Option<&T> {
        match self {
            OrOther::Known(t) => Some(t),
            OrOther::Other(_) => None,
        }
    }
}

impl<T> From<T> for OrOther<T> {
    fn from(t: T) -> Self {
        OrOther::Known(t)
    }
}

impl<'de, T: serde::de::DeserializeOwned> Deserialize<'de> for OrOther<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = JsJson::deserialize(d)?.0;
        Ok(match serde_json::from_value::<T>(v.clone()) {
            Ok(t) => OrOther::Known(t),
            Err(_) => OrOther::Other(v),
        })
    }
}

impl<T: Serialize> Serialize for OrOther<T> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            OrOther::Known(t) => t.serialize(s),
            OrOther::Other(v) => v.serialize(s),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct T {
        #[serde(deserialize_with = "num")]
        a: f64,
        #[serde(default, deserialize_with = "opt_num")]
        b: Option<f64>,
        #[serde(default, deserialize_with = "tuples")]
        c: Vec<[f64; 2]>,
    }

    #[test]
    fn reads_js_numbers() {
        let t: T =
            serde_json::from_str(r#"{"a":null,"b":"Infinity","c":[[1,"NaN"],[2,3]]}"#).unwrap();
        assert!(t.a.is_nan());
        assert_eq!(t.b, Some(f64::INFINITY));
        assert!(t.c[0][1].is_nan());
        let t: T = serde_json::from_str(r#"{"a":"-Infinity","c":null}"#).unwrap();
        assert_eq!(t.a, f64::NEG_INFINITY);
        assert_eq!(t.b, None);
        assert!(t.c.is_empty());
        assert!(serde_json::from_str::<T>(r#"{"a":1,"c":[[1,2,3]]}"#).is_err());
    }

    #[test]
    fn values_as_javascript_reads_them() {
        use serde_json::json;
        let n = |v: Value| js_to_number(Some(&v));
        assert_eq!(n(json!(" 2 ")), 2.0);
        assert_eq!(n(json!("0x10")), 16.0);
        assert_eq!(n(json!("")), 0.0);
        assert_eq!(n(json!(".5")), 0.5);
        assert_eq!(n(json!("5.")), 5.0);
        assert_eq!(n(json!("-Infinity")), f64::NEG_INFINITY);
        assert!(n(json!("inf")).is_nan());
        assert!(n(json!("1e")).is_nan());
        assert!(n(json!("abc")).is_nan());
        assert_eq!(n(json!(null)), 0.0);
        assert_eq!(n(json!(true)), 1.0);
        assert_eq!(n(json!([])), 0.0);
        assert_eq!(n(json!(["3"])), 3.0);
        assert!(n(json!([1, 2])).is_nan());
        assert!(n(json!({})).is_nan());
        assert!(js_to_number(None).is_nan());
        let s = |v: Value| js_to_string(Some(&v));
        assert_eq!(s(json!([1, null, [2, 3]])), "1,,2,3");
        assert_eq!(s(json!({ "a": 1 })), "[object Object]");
        assert_eq!(s(json!(1e21)), "1e+21");
        assert_eq!(js_to_string(None), "undefined");
        assert!(!js_is_finite(Some(&json!("1"))));
        assert!(js_global_is_finite(Some(&json!("1"))));
        assert!(!js_truthy(Some(&json!(0))) && js_truthy(Some(&json!([]))));
        let e = js_get(Some(&json!(null)), "aboveWater").unwrap_err();
        assert_eq!(
            e.message,
            "Cannot read properties of null (reading 'aboveWater')"
        );
        assert_eq!(js_get(Some(&json!(5)), "kind").unwrap(), None);
    }

    #[test]
    fn js_json_keeps_non_finite_numbers() {
        use serde::de::value::{Error, F64Deserializer};
        let read = |v: f64| {
            JsJson::deserialize(F64Deserializer::<Error>::new(v))
                .unwrap()
                .0
        };
        assert_eq!(read(f64::NAN), serde_json::json!("NaN"));
        assert_eq!(read(f64::INFINITY), serde_json::json!("Infinity"));
        assert_eq!(read(f64::NEG_INFINITY), serde_json::json!("-Infinity"));
        assert_eq!(read(1.5), serde_json::json!(1.5));
        // and they read back as JavaScript numbers
        assert!(num(read(f64::NAN)).unwrap().is_nan());
        assert_eq!(
            opt_num(read(f64::NEG_INFINITY)).unwrap(),
            Some(f64::NEG_INFINITY)
        );
    }
}
