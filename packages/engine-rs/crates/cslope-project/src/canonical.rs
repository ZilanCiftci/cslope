//! Canonical JSON as the app writes it (docs/file-format.md section 2,
//! `utils/canonical-json.ts`): the members of every object in the sorted
//! order of their keys (UTF-16 code unit order, JavaScript's default sort),
//! 2-space indentation as `JSON.stringify(value, null, 2)` lays it out,
//! `\n` line ends and one `\n` after the closing brace, numbers as
//! `JSON.stringify` writes them (`Number.prototype.toString`: the shortest
//! round-trip digits, `1e21`, `1e-7`, `-0` as `0`; a non-finite number as
//! `null`). The same value gives the same bytes here and in the app, which
//! the input hash (section 5) depends on.

use serde_json::Value;

/// The canonical text of a JSON value, with its final newline.
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write(value, 0, &mut out);
    out.push('\n');
    out
}

/// A number as `JSON.stringify` writes it.
pub fn json_number(x: f64) -> String {
    if x.is_finite() {
        // (ryu-js: the ECMAScript algorithm, ties of the shortest digits to
        // the even one; `-0` prints as "0" as JSON.stringify writes it)
        let x = if x == 0.0 { 0.0 } else { x };
        ryu_js::Buffer::new().format(x).to_owned()
    } else {
        "null".into()
    }
}

/// JavaScript's default sort of object keys: by UTF-16 code units.
fn key_order(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn indent(level: usize, out: &mut String) {
    for _ in 0..level {
        out.push_str("  ");
    }
}

fn write(value: &Value, level: usize, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&json_number(n.as_f64().unwrap_or(f64::NAN))),
        // (serde_json escapes `"`, `\` and the control characters, as
        // JSON.stringify does, with the same lowercase \u00xx form)
        Value::String(s) => out.push_str(&serde_json::to_string(s).expect("a string is JSON")),
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                indent(level + 1, out);
                write(item, level + 1, out);
                out.push_str(if i + 1 < items.len() { ",\n" } else { "\n" });
            }
            indent(level, out);
            out.push(']');
        }
        Value::Object(members) => {
            if members.is_empty() {
                out.push_str("{}");
                return;
            }
            let mut keys: Vec<&String> = members.keys().collect();
            keys.sort_by(|a, b| key_order(a, b));
            out.push_str("{\n");
            for (i, k) in keys.iter().enumerate() {
                indent(level + 1, out);
                out.push_str(&serde_json::to_string(k).expect("a key is JSON"));
                out.push_str(": ");
                write(&members[*k], level + 1, out);
                out.push_str(if i + 1 < keys.len() { ",\n" } else { "\n" });
            }
            indent(level, out);
            out.push('}');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lays_out_as_json_stringify_with_two_spaces() {
        let v =
            json!({ "b": [1, 2.5, { "y": null, "x": [] }], "a": "é\"\n\u{1}", "c": {}, "d": true });
        assert_eq!(
            canonical_json(&v),
            "{\n  \"a\": \"é\\\"\\n\\u0001\",\n  \"b\": [\n    1,\n    2.5,\n    {\n      \"x\": [],\n      \"y\": null\n    }\n  ],\n  \"c\": {},\n  \"d\": true\n}\n"
        );
    }

    #[test]
    fn sorts_keys_by_utf16_code_units() {
        // "\u{1F600}" (two code units, 0xD83D first) sorts before "\u{FF5E}"
        // in JavaScript, after it by Unicode scalar value
        let v = json!({ "\u{FF5E}": 1, "\u{1F600}": 2, "Z": 3, "a": 4, "_": 5 });
        let text = canonical_json(&v);
        let order: Vec<usize> = ["\"Z\"", "\"_\"", "\"a\"", "\"\u{1F600}\"", "\"\u{FF5E}\""]
            .iter()
            .map(|k| text.find(k).unwrap())
            .collect();
        assert!(order.windows(2).all(|w| w[0] < w[1]), "{text}");
    }

    #[test]
    fn numbers_as_json_stringify() {
        for (x, s) in [
            (0.0, "0"),
            (-0.0, "0"),
            (5.0, "5"),
            (0.1, "0.1"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1e-7, "1e-7"),
            (1e-6, "0.000001"),
            (123456789012345680000.0, "123456789012345680000"),
            (1.5e300, "1.5e+300"),
            (5e-324, "5e-324"),
            (f64::MAX, "1.7976931348623157e+308"),
            (-2.5e-10, "-2.5e-10"),
            (0.1 + 0.2, "0.30000000000000004"),
            (f64::NAN, "null"),
            (f64::INFINITY, "null"),
            (f64::NEG_INFINITY, "null"),
        ] {
            assert_eq!(json_number(x), s, "{x:?}");
        }
    }
}
