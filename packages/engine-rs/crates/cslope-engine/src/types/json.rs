//! JSON helpers for the API types (not a port of a TypeScript file): numbers
//! as JavaScript has them, with NaN and the infinities that plain JSON lacks.
//! A required number accepts a JSON number, `null` (what `JSON.stringify`
//! makes of NaN and ±Infinity) as NaN, and the strings "NaN", "Infinity",
//! "-Infinity" (the fixtures' encoding); used with `deserialize_with`.

use serde::de::{self, Deserialize, Deserializer, Visitor};
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
