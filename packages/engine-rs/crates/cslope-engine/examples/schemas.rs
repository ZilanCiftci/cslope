//! Prints the engine's JSON schemas (types/schema.rs) as one JSON object,
//! name -> schema, for tools/schema.ts:
//!
//!   cargo run --release -p cslope-engine --example schemas
#![allow(clippy::disallowed_methods)]

fn main() {
    let all = cslope_engine::types::schema::generate();
    println!(
        "{}",
        serde_json::to_string(&all).expect("the schemas serialize")
    );
}
