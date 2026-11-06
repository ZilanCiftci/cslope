//! A digest of a JSON value that does not depend on how numbers are
//! written: FNV-1a 64 over the value, objects with their keys in byte
//! order, numbers as their IEEE 754 bits (-0 as 0). The golden corpus
//! (packages/desktop/scripts/project-corpus.ts, which has the same function)
//! holds the larger expected values as these digests.

use serde_json::Value;

const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

struct Fnv(u64);

impl Fnv {
    fn bytes(&mut self, b: &[u8]) {
        for &x in b {
            self.0 = (self.0 ^ u64::from(x)).wrapping_mul(PRIME);
        }
    }
    fn len(&mut self, n: usize) {
        self.bytes(&(n as u32).to_le_bytes());
    }
    fn str(&mut self, s: &str) {
        self.len(s.len());
        self.bytes(s.as_bytes());
    }
    fn feed(&mut self, v: &Value) {
        match v {
            Value::Null => self.bytes(b"n"),
            Value::Bool(b) => self.bytes(if *b { b"t" } else { b"f" }),
            Value::Number(n) => {
                self.bytes(b"d");
                let x = n.as_f64().unwrap_or(f64::NAN);
                let x = if x == 0.0 { 0.0 } else { x };
                self.bytes(&x.to_le_bytes());
            }
            Value::String(s) => {
                self.bytes(b"s");
                self.str(s);
            }
            Value::Array(a) => {
                self.bytes(b"a");
                self.len(a.len());
                for x in a {
                    self.feed(x);
                }
            }
            Value::Object(o) => {
                let mut keys: Vec<&String> = o.keys().collect();
                keys.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
                self.bytes(b"o");
                self.len(keys.len());
                for k in keys {
                    self.str(k);
                    self.feed(&o[k]);
                }
            }
        }
    }
}

/// The digest of a JSON value, as 16 hex digits.
pub fn digest(value: &Value) -> String {
    let mut h = Fnv(OFFSET);
    h.feed(value);
    format!("{:016x}", h.0)
}
