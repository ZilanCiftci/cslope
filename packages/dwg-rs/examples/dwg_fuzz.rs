//! Robustness of the DWG reader on damaged copies of real files:
//!
//!   cargo run --release --example dwg_fuzz -- ROUNDS FILE.dwg...
//!
//! Per file: truncations at 50 lengths and ROUNDS copies with 1 to 64 random
//! byte flips. Counts the outcomes of `read_dwg` (drawing, error) and the
//! panics inside acadrust (caught: by acadrust itself or by the wrapper;
//! in the app's WebAssembly build each would trap the instance instead),
//! and the slowest read.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

static PANICS: AtomicUsize = AtomicUsize::new(0);
static WHERE: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

fn main() {
    std::panic::set_hook(Box::new(|info| {
        PANICS.fetch_add(1, Ordering::SeqCst);
        let at = info
            .location()
            .map(|l| {
                format!(
                    "{}:{}",
                    l.file().rsplit("/src/").next().unwrap_or(""),
                    l.line()
                )
            })
            .unwrap_or_default();
        let msg = info
            .payload()
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| info.payload().downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default();
        WHERE.lock().unwrap().insert(format!(
            "{at} {}",
            msg.chars().take(100).collect::<String>()
        ));
    }));
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rounds: usize = args[0].parse().unwrap();
    for file in &args[1..] {
        let bytes = std::fs::read(file).unwrap();
        let (mut ok, mut err, mut slowest) = (0, 0, 0.0f64);
        let mut panic_inputs = 0;
        let mut run = |input: &[u8]| {
            let before = PANICS.load(Ordering::SeqCst);
            let t = Instant::now();
            match cslope_dwg::read_dwg(input) {
                Ok(_) => ok += 1,
                Err(_) => err += 1,
            }
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            if ms > 1000.0 {
                println!("  slow: {ms:.0} ms on a {}-byte input", input.len());
            }
            slowest = slowest.max(ms);
            if PANICS.load(Ordering::SeqCst) > before {
                panic_inputs += 1;
            }
        };
        for k in 0..50 {
            run(&bytes[..bytes.len() * k / 50]);
        }
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            seed >> 11
        };
        for r in 0..rounds {
            let mut damaged = bytes.clone();
            let flips = 1 + r % 64;
            for _ in 0..flips {
                let i = next() as usize % damaged.len();
                damaged[i] ^= (next() as u8) | 1;
            }
            run(&damaged);
        }
        println!(
            "{{\"file\":\"{file}\",\"inputs\":{},\"ok\":{ok},\"err\":{err},\"panickingInputs\":{panic_inputs},\"slowestMs\":{slowest:.1}}}",
            50 + rounds
        );
        for w in std::mem::take(&mut *WHERE.lock().unwrap()) {
            println!("  panic at {w}");
        }
    }
}
