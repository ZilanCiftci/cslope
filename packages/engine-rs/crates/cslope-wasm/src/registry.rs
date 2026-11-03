//! Handles for engine objects that live in WebAssembly memory
//! (ARCHITECTURE.md §3.1): a slab of slots, each with a generation, behind a
//! `u32` handle. The facade holds the handle in its JavaScript object, frees
//! it explicitly (`free()`, `[Symbol.dispose]`) or through a
//! `FinalizationRegistry`. One registry per object type, in a
//! `thread_local!` (a WebAssembly instance is single-threaded).
//!
//! A handle is `generation << INDEX_BITS | index`. A freed slot's generation
//! is bumped, so a stale handle (freed, or from before an engine restart)
//! is reported instead of reaching another object. Generations run from 1
//! (0 is never a valid handle) and wrap after 2^12 reuses of one slot.
//!
//! Reentrancy: a long operation takes the value out of its slot
//! ([`Registry::take`]) and puts it back afterwards, so no `RefCell` borrow
//! is held while JavaScript runs (progress callbacks); a call on the same
//! handle meanwhile gets [`HandleError::InUse`].

use std::fmt;

const INDEX_BITS: u32 = 20;
const INDEX_MASK: u32 = (1 << INDEX_BITS) - 1;
const GENERATION_MASK: u32 = (1 << (32 - INDEX_BITS)) - 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandleError {
    /// Never issued, freed, or from an earlier engine instance.
    Stale,
    /// Taken by a running operation.
    InUse,
    /// More live objects than handles.
    Full,
}

impl fmt::Display for HandleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            HandleError::Stale => {
                "The object was freed, or the engine was restarted after an internal error; build it again."
            }
            HandleError::InUse => "The object is in use by a running analysis.",
            HandleError::Full => "Too many engine objects are alive; free some first.",
        })
    }
}

enum Slot<T> {
    Free {
        generation: u32,
        next_free: Option<u32>,
    },
    Live {
        generation: u32,
        value: T,
    },
    Taken {
        generation: u32,
    },
}

pub struct Registry<T> {
    slots: Vec<Slot<T>>,
    free_head: Option<u32>,
    live: usize,
}

impl<T> Default for Registry<T> {
    fn default() -> Self {
        Self::new()
    }
}

fn pack(index: u32, generation: u32) -> u32 {
    (generation << INDEX_BITS) | index
}

fn unpack(handle: u32) -> (u32, u32) {
    (handle & INDEX_MASK, handle >> INDEX_BITS)
}

fn next_generation(g: u32) -> u32 {
    let n = (g + 1) & GENERATION_MASK;
    if n == 0 {
        1
    } else {
        n
    }
}

impl<T> Registry<T> {
    pub const fn new() -> Self {
        Registry {
            slots: Vec::new(),
            free_head: None,
            live: 0,
        }
    }

    /// Number of live (or taken) objects.
    pub fn len(&self) -> usize {
        self.live
    }

    pub fn is_empty(&self) -> bool {
        self.live == 0
    }

    /// Stores `value` and returns its handle.
    pub fn insert(&mut self, value: T) -> Result<u32, HandleError> {
        if let Some(index) = self.free_head {
            let slot = &mut self.slots[index as usize];
            let Slot::Free {
                generation,
                next_free,
            } = *slot
            else {
                unreachable!("the free list holds free slots only")
            };
            self.free_head = next_free;
            *slot = Slot::Live { generation, value };
            self.live += 1;
            return Ok(pack(index, generation));
        }
        let index = self.slots.len() as u32;
        if index > INDEX_MASK {
            return Err(HandleError::Full);
        }
        self.slots.push(Slot::Live {
            generation: 1,
            value,
        });
        self.live += 1;
        Ok(pack(index, 1))
    }

    fn slot(&self, handle: u32) -> Option<&Slot<T>> {
        let (index, generation) = unpack(handle);
        let slot = self.slots.get(index as usize)?;
        let g = match slot {
            Slot::Free { generation, .. }
            | Slot::Live { generation, .. }
            | Slot::Taken { generation } => *generation,
        };
        (g == generation && !matches!(slot, Slot::Free { .. })).then_some(slot)
    }

    pub fn get(&self, handle: u32) -> Result<&T, HandleError> {
        match self.slot(handle) {
            Some(Slot::Live { value, .. }) => Ok(value),
            Some(Slot::Taken { .. }) => Err(HandleError::InUse),
            _ => Err(HandleError::Stale),
        }
    }

    pub fn get_mut(&mut self, handle: u32) -> Result<&mut T, HandleError> {
        match self.slot(handle) {
            Some(Slot::Live { .. }) => {}
            Some(Slot::Taken { .. }) => return Err(HandleError::InUse),
            _ => return Err(HandleError::Stale),
        }
        let (index, _) = unpack(handle);
        match &mut self.slots[index as usize] {
            Slot::Live { value, .. } => Ok(value),
            _ => unreachable!("checked above"),
        }
    }

    /// Takes the value out for a long operation; [`Registry::put_back`]
    /// returns it.
    pub fn take(&mut self, handle: u32) -> Result<T, HandleError> {
        self.get(handle)?;
        let (index, generation) = unpack(handle);
        match std::mem::replace(&mut self.slots[index as usize], Slot::Taken { generation }) {
            Slot::Live { value, .. } => Ok(value),
            _ => unreachable!("checked above"),
        }
    }

    /// Returns a value taken with [`Registry::take`]. If the handle was freed
    /// meanwhile, the value is dropped.
    pub fn put_back(&mut self, handle: u32, value: T) {
        let (index, generation) = unpack(handle);
        if let Some(slot @ Slot::Taken { .. }) = self.slots.get_mut(index as usize) {
            if matches!(slot, Slot::Taken { generation: g } if *g == generation) {
                *slot = Slot::Live { generation, value };
            }
        }
    }

    /// Frees the object (also while it is taken: the value is dropped when
    /// put back). Freeing a stale handle is a no-op and returns false, so a
    /// `free()` followed by the finaliser is harmless.
    pub fn remove(&mut self, handle: u32) -> bool {
        if self.slot(handle).is_none() {
            return false;
        }
        let (index, generation) = unpack(handle);
        self.slots[index as usize] = Slot::Free {
            generation: next_generation(generation),
            next_free: self.free_head,
        };
        self.free_head = Some(index);
        self.live -= 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_are_generational() {
        let mut r: Registry<String> = Registry::new();
        let a = r.insert("a".into()).unwrap();
        let b = r.insert("b".into()).unwrap();
        assert_ne!(a, 0);
        assert_eq!(r.get(a).unwrap(), "a");
        assert_eq!(r.get(b).unwrap(), "b");
        assert!(r.remove(a));
        assert!(!r.remove(a));
        assert_eq!(r.get(a), Err(HandleError::Stale));
        let c = r.insert("c".into()).unwrap();
        // the slot is reused with a new generation
        assert_eq!(c & INDEX_MASK, a & INDEX_MASK);
        assert_ne!(c, a);
        assert_eq!(r.get(a), Err(HandleError::Stale));
        assert_eq!(r.get(c).unwrap(), "c");
        assert_eq!(r.len(), 2);
        assert_eq!(r.get(0), Err(HandleError::Stale));
        assert_eq!(r.get(12345), Err(HandleError::Stale));
    }

    #[test]
    fn take_and_put_back() {
        let mut r: Registry<Vec<f64>> = Registry::new();
        let h = r.insert(vec![1.0]).unwrap();
        let mut v = r.take(h).unwrap();
        assert_eq!(r.get(h), Err(HandleError::InUse));
        assert_eq!(r.get_mut(h).err(), Some(HandleError::InUse));
        assert_eq!(r.take(h), Err(HandleError::InUse));
        v.push(2.0);
        r.put_back(h, v);
        assert_eq!(r.get(h).unwrap(), &vec![1.0, 2.0]);
        // freed while taken: put_back drops the value
        let v = r.take(h).unwrap();
        assert!(r.remove(h));
        r.put_back(h, v);
        assert_eq!(r.get(h), Err(HandleError::Stale));
        assert!(r.is_empty());
    }

    #[test]
    fn generations_wrap_past_zero() {
        let mut r: Registry<u8> = Registry::new();
        let mut h = r.insert(0).unwrap();
        for _ in 0..(GENERATION_MASK + 3) {
            assert!(r.remove(h));
            h = r.insert(0).unwrap();
            assert_ne!(h >> INDEX_BITS, 0);
        }
    }
}
