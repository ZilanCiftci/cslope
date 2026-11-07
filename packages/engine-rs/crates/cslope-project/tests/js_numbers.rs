//! The number formatting of the canonical JSON writer against Bun's
//! `JSON.stringify`: the sample in the golden corpus (made by
//! packages/desktop/scripts/project-corpus.ts, a seeded sequence of random
//! doubles and the special values), and, when `CSLOPE_JS_NUMBERS` names a
//! file of lines `<16 hex digits of the bits>\t<text>`, every number in it
//! (the development check ran 1.2 million random doubles and the special
//! values through it).

use cslope_project::canonical::json_number;
use std::path::PathBuf;

fn check(bits: &str, expected: &str) {
    let x = f64::from_bits(u64::from_str_radix(bits, 16).expect("hex bits"));
    assert_eq!(json_number(x), expected, "bits {bits} ({x:e})");
}

#[test]
fn numbers_in_the_corpus_format_as_bun_writes_them() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../golden/project-corpus.json");
    let text = std::fs::read_to_string(path).expect("golden/project-corpus.json");
    let corpus: serde_json::Value = serde_json::from_str(&text).expect("JSON");
    let numbers = corpus["jsNumbers"]
        .as_array()
        .expect("jsNumbers in the corpus");
    assert!(numbers.len() >= 1000);
    for pair in numbers {
        check(pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
    }
}

#[test]
fn numbers_in_the_given_file_format_as_bun_writes_them() {
    let Some(path) = std::env::var_os("CSLOPE_JS_NUMBERS") else {
        return;
    };
    let text = std::fs::read_to_string(&path).expect("the numbers file");
    let mut n = 0;
    for line in text.lines() {
        let (bits, expected) = line.split_once('\t').expect("bits\\ttext");
        check(bits, expected);
        n += 1;
    }
    assert!(n > 0);
}
