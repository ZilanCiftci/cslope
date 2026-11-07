//! Correctly rounded `hypot(x, y)`, as std's `f64::hypot` computes it in
//! WebAssembly.
//!
//! The `libm` crate's latest release (0.2.16) still has musl's `hypot`,
//! which is not correctly rounded; the Rust toolchain's own copy of libm
//! (compiler-builtins, which std calls on wasm32) has the CORE-MATH port
//! below. The committed WebAssembly engine's results were made with it, so
//! this file is that port,
//! unchanged apart from spelling the hexadecimal float constants as bits,
//! `fma` as `libm::fma` and `max`/`min` of the two non-negative, non-NaN
//! operands as comparisons.
//!
//! Source: rust-lang/compiler-builtins, `libm/src/math/hypot.rs`
//! (origin: core-math/src/binary64/hypot/hypot.c, Copyright (c) 2022
//! Alexei Sibidanov, ported to Rust in 2025; MIT licence, as the `libm`
//! crate).

/// 0x1p-27
const TWO_M27: f64 = f64::from_bits(0x3e40_0000_0000_0000);
/// 0x1p-54
const TWO_M54: f64 = f64::from_bits(0x3c90_0000_0000_0000);

fn fma(x: f64, y: f64, z: f64) -> f64 {
    libm::fma(x, y, z)
}

pub(super) fn hypot(mut x: f64, mut y: f64) -> f64 {
    let xi = x.to_bits();
    let yi = y.to_bits();

    let emsk: u64 = 0x7ffu64 << 52;
    let mut ex: u64 = xi & emsk;
    let mut ey: u64 = yi & emsk;
    // emsk corresponds to the upper bits of NaN and Inf (apart the sign bit)
    x = x.abs();
    y = y.abs();
    if ex == emsk || ey == emsk {
        // Either x or y is NaN or Inf
        let wx: u64 = xi << 1;
        let wy: u64 = yi << 1;
        let wm: u64 = emsk << 1;

        let one_inf = (wx == wm) ^ (wy == wm);
        let one_nan = x.is_nan() ^ y.is_nan();

        // IEEE 754 says that hypot(+/-Inf,qNaN)=hypot(qNaN,+/-Inf)=+Inf.
        if one_inf && one_nan {
            return f64::INFINITY;
        }
        return x + y; // inf, sNaN
    }

    let (u, v) = if x >= y { (x, y) } else { (y, x) };
    let mut xd: u64 = u.to_bits();
    let mut yd: u64 = v.to_bits();
    ey = yd;

    if ey >> 52 == 0 {
        if yd == 0 {
            return f64::from_bits(xd);
        }

        ex = xd;

        if ex >> 52 == 0 {
            if ex == 0 {
                return 0.0;
            }

            return as_hypot_denorm(ex, ey);
        }

        let nz: u32 = ey.leading_zeros();
        ey <<= nz - 11;
        ey &= u64::MAX >> 12;
        ey = ey.wrapping_sub(((nz as i64 - 12i64) << 52) as u64);
        yd = ey;
    }

    let de: u64 = xd.wrapping_sub(yd);
    if de > (27_u64 << 52) {
        return fma(TWO_M27, v, u);
    }

    let off: i64 = (0x3ff_i64 << 52) - (xd & emsk) as i64;
    xd = xd.wrapping_add(off as u64);
    yd = yd.wrapping_add(off as u64);
    x = f64::from_bits(xd);
    y = f64::from_bits(yd);
    let x2: f64 = x * x;
    let dx2: f64 = fma(x, x, -x2);
    let y2: f64 = y * y;
    let dy2: f64 = fma(y, y, -y2);
    let r2: f64 = x2 + y2;
    let ir2: f64 = 0.5 / r2;
    let dr2: f64 = ((x2 - r2) + y2) + (dx2 + dy2);
    let mut th: f64 = r2.sqrt();
    let rsqrt: f64 = th * ir2;
    let dz: f64 = dr2 - fma(th, th, -r2);
    let mut tl: f64 = rsqrt * dz;
    th = fasttwosum(th, tl, &mut tl);
    let mut thd: u64 = th.to_bits();
    let tld = tl.abs().to_bits();
    ex = thd;
    ey = tld;
    ex &= 0x7ff_u64 << 52;
    let aidr: u64 = ey.wrapping_add(0x3fe_u64 << 52).wrapping_sub(ex);
    let mid: u64 = (aidr.wrapping_sub(0x3c90000000000000).wrapping_add(16)) >> 5;
    if mid == 0 || !(0x39b0000000000000_u64..=0x3c9fffffffffff80_u64).contains(&aidr) {
        thd = as_hypot_hard(x, y).to_bits();
    }
    thd = thd.wrapping_sub(off as u64);
    if thd >= (0x7ff_u64 << 52) {
        return as_hypot_overflow();
    }

    f64::from_bits(thd)
}

fn fasttwosum(x: f64, y: f64, e: &mut f64) -> f64 {
    let s: f64 = x + y;
    let z: f64 = s - x;
    *e = y - z;
    s
}

fn as_hypot_overflow() -> f64 {
    let z: f64 = f64::MAX;
    z + z
}

/// Here the square root is refined by Newton iterations: x^2+y^2 is exact
/// and fits in a 128-bit integer, so the approximation is squared (which
/// also fits in a 128-bit integer), compared and adjusted if necessary using
/// the exact value of x^2+y^2.
fn as_hypot_hard(x: f64, y: f64) -> f64 {
    let op: f64 = 1.0 + TWO_M54;
    let om: f64 = 1.0 - TWO_M54;
    let mut xi: u64 = x.to_bits();
    let yi: u64 = y.to_bits();
    let mut bm: u64 = (xi & (u64::MAX >> 12)) | 1u64 << 52;
    let mut lm: u64 = (yi & (u64::MAX >> 12)) | 1u64 << 52;
    let be: i32 = (xi >> 52) as i32;
    let le: i32 = (yi >> 52) as i32;
    let ri: u64 = (x * x + y * y).sqrt().to_bits();
    let bs: i32 = 2;
    let mut rm: u64 = ri & (u64::MAX >> 12);
    let mut re: i32 = (ri >> 52) as i32 - 0x3ff;
    rm |= 1u64 << 52;

    for _ in 0..3 {
        if rm == 1u64 << 52 {
            rm = u64::MAX >> 11;
            re -= 1;
        } else {
            rm -= 1;
        }
    }

    bm <<= bs;
    let mut m2: u64 = bm.wrapping_mul(bm);
    let de: i32 = be - le;
    let mut ls: i32 = bs - de;

    if ls >= 0 {
        lm <<= ls;
        m2 = m2.wrapping_add(lm.wrapping_mul(lm));
    } else {
        let lm2: u128 = (lm as u128) * (lm as u128);
        ls *= 2;
        m2 = m2.wrapping_add((lm2 >> -ls) as u64);
        m2 |= ((lm2 << (128 + ls)) != 0) as u64;
    }

    let k: i32 = bs + re;
    let mut d: i64;

    loop {
        rm += 1 + (rm >= (1u64 << 53)) as u64;
        let tm: u64 = rm << k;
        let rm2: u64 = tm.wrapping_mul(tm);
        d = m2 as i64 - rm2 as i64;

        if d <= 0 {
            break;
        }
    }

    if d == 0 {
        // exact
    } else if op == om {
        let tm: u64 = (rm << k) - (1 << (k - (rm <= (1u64 << 53)) as i32));
        d = m2 as i64 - (tm.wrapping_mul(tm)) as i64;

        if d == 0 {
            rm -= rm & 1;
        } else {
            rm = rm.wrapping_add((d >> 63) as u64);
        }
    } else {
        rm -= ((op == 1.0) as u64) << (rm > (1u64 << 53)) as u32;
    }

    if rm >= (1u64 << 53) {
        rm >>= 1;
        re += 1;
    }

    let e: u64 = (be - 1 + re) as u64;
    xi = (e << 52) + rm;

    f64::from_bits(xi)
}

fn as_hypot_denorm(mut a: u64, mut b: u64) -> f64 {
    let op: f64 = 1.0 + TWO_M54;
    let om: f64 = 1.0 - TWO_M54;
    let af: f64 = a as i64 as f64;
    let bf: f64 = b as i64 as f64;
    a <<= 1;
    b <<= 1;
    let mut rm: u64 = (af * af + bf * bf).sqrt() as u64;
    let tm: u64 = rm << 1;
    let mut d: i64 = (a.wrapping_mul(a) as i64)
        .wrapping_sub(tm.wrapping_mul(tm) as i64)
        .wrapping_add(b.wrapping_mul(b) as i64);
    let sd: i64 = d >> 63;
    let um: i64 = ((rm as i64) ^ sd) - sd;
    let mut drm: i64 = sd + 1;
    let mut dd: i64 = (um << 3) + 4;
    let mut p_d: i64;
    rm -= drm as u64;
    drm += sd;
    loop {
        p_d = d;
        rm = rm.wrapping_add(drm as u64);
        d = d.wrapping_sub(dd);
        dd = dd.wrapping_add(8);
        if (d ^ p_d) <= 0 {
            break;
        }
    }
    p_d = (sd & d) + (!sd & p_d);
    if p_d != 0 {
        if op == om {
            let sum: i64 = p_d
                .wrapping_sub(4u64.wrapping_mul(rm) as i64)
                .wrapping_sub(1);

            if sum != 0 {
                rm = rm.wrapping_add((sum >> 63).wrapping_add(1) as u64);
            } else {
                rm += rm & 1;
            }
        } else {
            rm += (op > 1.0) as u64;
        }
    }

    f64::from_bits(rm)
}
