//! Array helpers with JavaScript semantics.

/// `array.sort((a, b) => f(a, b))` as V8 sorts: a port of V8's TimSort
/// (V8 12.4, `third_party/v8/builtins/array-sort.tq`, the version in the
/// Node and Electron the app ships with). The JS comparator contract holds
/// (< 0: a first; > 0: b first; 0 or NaN: keep order) and the sort is
/// stable. Because it is V8's algorithm step by step (natural runs, binary
/// insertion to the minimum run length, the merge stack, galloping with the
/// same adaptive threshold), the comparator is called on the same pairs in
/// the same order as in V8, so even an inconsistent comparator (NaN keys,
/// `a - b` with infinities) gives V8's order. It never panics, whatever the
/// comparator returns.
///
/// The work array holds indices into `items`; the permutation is applied
/// at the end, so `T` need not be `Clone`.
pub fn sort_by<T>(items: &mut [T], mut compare: impl FnMut(&T, &T) -> f64) {
    let n = items.len();
    // Array.prototype.sort: "if (len < 2) return obj" (no comparisons).
    if n < 2 {
        return;
    }
    let order = {
        let items: &[T] = items;
        // SortCompareUserFn: a NaN result is +0.
        let mut cmp = |a: usize, b: usize| -> f64 {
            let v = compare(&items[a], &items[b]);
            if v.is_nan() {
                0.0
            } else {
                v
            }
        };
        let mut state = TimSort {
            work: (0..n).collect(),
            temp: Vec::new(),
            pending: Vec::new(),
            min_gallop: MIN_GALLOP_WINS,
        };
        state.sort(&mut cmp);
        state.work
    };
    apply_permutation(items, order);
}

/// Reorder `items` so that position k holds the element that was at
/// `order[k]` (cycle by cycle, with swaps).
fn apply_permutation<T>(items: &mut [T], order: Vec<usize>) {
    let mut done = vec![false; order.len()];
    for start in 0..order.len() {
        if done[start] {
            continue;
        }
        let mut j = start;
        loop {
            done[j] = true;
            let next = order[j];
            if next == start {
                break;
            }
            items.swap(j, next);
            j = next;
        }
    }
}

/// `kMinGallopWins`: galloping starts after this many wins in a row.
const MIN_GALLOP_WINS: isize = 7;
/// `kSortStateTempSize`: the smallest temporary array.
const SORT_STATE_TEMP_SIZE: usize = 32;

/// `SortState`, as far as the algorithm uses it. Indices are `isize` as
/// V8's Smis (offsets in the galloping searches go to -1).
struct TimSort {
    work: Vec<usize>,
    temp: Vec<usize>,
    /// The pending runs `(base, length)`.
    pending: Vec<(isize, isize)>,
    min_gallop: isize,
}

/// How a merge ends (the Torque labels of MergeLow / MergeHigh).
enum MergeExit {
    Succeed,
    CopyRest,
}

fn at(a: &[usize], i: isize) -> usize {
    a[i as usize]
}

/// `ComputeMinRunLength`.
fn compute_min_run_length(n_arg: isize) -> isize {
    let mut n = n_arg;
    let mut r = 0;
    while n >= 64 {
        r |= n & 1;
        n >>= 1;
    }
    n + r
}

/// `GallopLeft`: the offset in `0..=length` where `key` belongs in the
/// sorted `array[base..base + length]`, left of any equal elements.
fn gallop_left(
    cmp: &mut impl FnMut(usize, usize) -> f64,
    array: &[usize],
    key: usize,
    base: isize,
    length: isize,
    hint: isize,
) -> isize {
    let mut last_ofs: isize = 0;
    let mut offset: isize = 1;
    let base_hint_element = at(array, base + hint);
    let mut order = cmp(base_hint_element, key);
    if order < 0.0 {
        // a[base + hint] < key: gallop right.
        let max_ofs = length - hint;
        while offset < max_ofs {
            let offset_element = at(array, base + hint + offset);
            order = cmp(offset_element, key);
            if order >= 0.0 {
                break;
            }
            last_ofs = offset;
            offset = (offset << 1) + 1;
            if offset <= 0 {
                offset = max_ofs;
            }
        }
        if offset > max_ofs {
            offset = max_ofs;
        }
        last_ofs += hint;
        offset += hint;
    } else {
        // key <= a[base + hint]: gallop left.
        let max_ofs = hint + 1;
        while offset < max_ofs {
            let offset_element = at(array, base + hint - offset);
            order = cmp(offset_element, key);
            if order < 0.0 {
                break;
            }
            last_ofs = offset;
            offset = (offset << 1) + 1;
            if offset <= 0 {
                offset = max_ofs;
            }
        }
        if offset > max_ofs {
            offset = max_ofs;
        }
        let tmp = last_ofs;
        last_ofs = hint - offset;
        offset = hint - tmp;
    }
    // Binary search in (lastOfs, offset].
    last_ofs += 1;
    while last_ofs < offset {
        let m = last_ofs + ((offset - last_ofs) >> 1);
        order = cmp(at(array, base + m), key);
        if order < 0.0 {
            last_ofs = m + 1;
        } else {
            offset = m;
        }
    }
    offset
}

/// `GallopRight`: as `gallop_left`, but right of any equal elements.
fn gallop_right(
    cmp: &mut impl FnMut(usize, usize) -> f64,
    array: &[usize],
    key: usize,
    base: isize,
    length: isize,
    hint: isize,
) -> isize {
    let mut last_ofs: isize = 0;
    let mut offset: isize = 1;
    let base_hint_element = at(array, base + hint);
    let mut order = cmp(key, base_hint_element);
    if order < 0.0 {
        // key < a[base + hint]: gallop left.
        let max_ofs = hint + 1;
        while offset < max_ofs {
            let offset_element = at(array, base + hint - offset);
            order = cmp(key, offset_element);
            if order >= 0.0 {
                break;
            }
            last_ofs = offset;
            offset = (offset << 1) + 1;
            if offset <= 0 {
                offset = max_ofs;
            }
        }
        if offset > max_ofs {
            offset = max_ofs;
        }
        let tmp = last_ofs;
        last_ofs = hint - offset;
        offset = hint - tmp;
    } else {
        // a[base + hint] <= key: gallop right.
        let max_ofs = length - hint;
        while offset < max_ofs {
            let offset_element = at(array, base + hint + offset);
            order = cmp(key, offset_element);
            if order < 0.0 {
                break;
            }
            last_ofs = offset;
            offset = (offset << 1) + 1;
            if offset <= 0 {
                offset = max_ofs;
            }
        }
        if offset > max_ofs {
            offset = max_ofs;
        }
        last_ofs += hint;
        offset += hint;
    }
    last_ofs += 1;
    while last_ofs < offset {
        let m = last_ofs + ((offset - last_ofs) >> 1);
        order = cmp(key, at(array, base + m));
        if order < 0.0 {
            offset = m;
        } else {
            last_ofs = m + 1;
        }
    }
    offset
}

impl TimSort {
    /// `ArrayTimSortImpl`.
    fn sort(&mut self, cmp: &mut impl FnMut(usize, usize) -> f64) {
        let length = self.work.len() as isize;
        if length < 2 {
            return;
        }
        let mut remaining = length;
        let mut low: isize = 0;
        let min_run_length = compute_min_run_length(remaining);
        while remaining != 0 {
            let mut current_run_length = self.count_and_make_run(cmp, low, low + remaining);
            // If the run is short, extend it to min(minRunLength, remaining).
            if current_run_length < min_run_length {
                let forced_run_length = min_run_length.min(remaining);
                self.binary_insertion_sort(
                    cmp,
                    low,
                    low + current_run_length,
                    low + forced_run_length,
                );
                current_run_length = forced_run_length;
            }
            self.pending.push((low, current_run_length));
            self.merge_collapse(cmp);
            low += current_run_length;
            remaining -= current_run_length;
        }
        self.merge_force_collapse(cmp);
    }

    /// `BinaryInsertionSort(low, start, high)`: [low, start) is sorted.
    fn binary_insertion_sort(
        &mut self,
        cmp: &mut impl FnMut(usize, usize) -> f64,
        low: isize,
        start_arg: isize,
        high: isize,
    ) {
        let mut start = if low == start_arg {
            start_arg + 1
        } else {
            start_arg
        };
        while start < high {
            let mut left = low;
            let mut right = start;
            let pivot = at(&self.work, right);
            while left < right {
                let mid = left + ((right - left) >> 1);
                let order = cmp(pivot, at(&self.work, mid));
                if order < 0.0 {
                    right = mid;
                } else {
                    left = mid + 1;
                }
            }
            let mut p = start;
            while p > left {
                self.work[p as usize] = self.work[(p - 1) as usize];
                p -= 1;
            }
            self.work[left as usize] = pivot;
            start += 1;
        }
    }

    /// `CountAndMakeRun`: the length of the run at `low_arg` (ascending, or
    /// strictly descending and then reversed).
    fn count_and_make_run(
        &mut self,
        cmp: &mut impl FnMut(usize, usize) -> f64,
        low_arg: isize,
        high: isize,
    ) -> isize {
        let low = low_arg + 1;
        if low == high {
            return 1;
        }
        let mut run_length: isize = 2;
        let element_low = at(&self.work, low);
        let element_low_pred = at(&self.work, low - 1);
        let mut order = cmp(element_low, element_low_pred);
        let is_descending = order < 0.0;
        let mut previous_element = element_low;
        let mut idx = low + 1;
        while idx < high {
            let current_element = at(&self.work, idx);
            order = cmp(current_element, previous_element);
            if is_descending {
                if order >= 0.0 {
                    break;
                }
            } else if order < 0.0 {
                break;
            }
            previous_element = current_element;
            run_length += 1;
            idx += 1;
        }
        if is_descending {
            self.work[low_arg as usize..(low_arg + run_length) as usize].reverse();
        }
        run_length
    }

    /// `GetTempArray`: at least `requested` (and kSortStateTempSize) long.
    fn ensure_temp(&mut self, requested: isize) {
        let min_size = SORT_STATE_TEMP_SIZE.max(requested as usize);
        if self.temp.len() < min_size {
            self.temp = vec![0; min_size];
        }
    }

    /// `Copy` within the work array (overlapping ranges as V8: a move).
    fn copy_work(&mut self, src: isize, dst: isize, length: isize) {
        let (src, dst, length) = (src as usize, dst as usize, length as usize);
        self.work.copy_within(src..src + length, dst);
    }

    fn copy_temp_to_work(&mut self, src: isize, dst: isize, length: isize) {
        let (src, dst, length) = (src as usize, dst as usize, length as usize);
        self.work[dst..dst + length].copy_from_slice(&self.temp[src..src + length]);
    }

    /// `MergeAt(i)`: merge the runs at stack indices i and i + 1.
    fn merge_at(&mut self, cmp: &mut impl FnMut(usize, usize) -> f64, i: usize) {
        let stack_size = self.pending.len();
        let (mut base_a, mut length_a) = self.pending[i];
        let (base_b, mut length_b) = self.pending[i + 1];
        self.pending[i].1 = length_a + length_b;
        if i + 3 == stack_size {
            self.pending[i + 1] = self.pending[i + 2];
        }
        self.pending.pop();

        // Where does b start in a? Elements in a before that are in place.
        let key_right = at(&self.work, base_b);
        let k = gallop_right(cmp, &self.work, key_right, base_a, length_a, 0);
        base_a += k;
        length_a -= k;
        if length_a == 0 {
            return;
        }
        // Where does a end in b? Elements in b after that are in place.
        let key_left = at(&self.work, base_a + length_a - 1);
        length_b = gallop_left(cmp, &self.work, key_left, base_b, length_b, length_b - 1);
        if length_b == 0 {
            return;
        }
        if length_a <= length_b {
            self.merge_low(cmp, base_a, length_a, base_b, length_b);
        } else {
            self.merge_high(cmp, base_a, length_a, base_b, length_b);
        }
    }

    /// `MergeLow`: merge with a copy of run A (the shorter) in the temp
    /// array, front to back.
    fn merge_low(
        &mut self,
        cmp: &mut impl FnMut(usize, usize) -> f64,
        base_a: isize,
        length_a_arg: isize,
        base_b: isize,
        length_b_arg: isize,
    ) {
        let mut length_a = length_a_arg;
        let mut length_b = length_b_arg;
        self.ensure_temp(length_a);
        let (a0, la) = (base_a as usize, length_a as usize);
        self.temp[..la].copy_from_slice(&self.work[a0..a0 + la]);

        let mut dest = base_a;
        let mut cursor_temp: isize = 0;
        let mut cursor_b = base_b;

        self.work[dest as usize] = at(&self.work, cursor_b);
        dest += 1;
        cursor_b += 1;

        let exit = 'merge: {
            length_b -= 1;
            if length_b == 0 {
                break 'merge MergeExit::Succeed;
            }
            if length_a == 1 {
                break 'merge MergeExit::CopyRest;
            }
            let mut min_gallop = self.min_gallop;
            loop {
                let mut nof_wins_a: isize = 0;
                let mut nof_wins_b: isize = 0;
                // Straightforward merging until one run wins consistently.
                loop {
                    let order = cmp(at(&self.work, cursor_b), at(&self.temp, cursor_temp));
                    if order < 0.0 {
                        self.work[dest as usize] = at(&self.work, cursor_b);
                        dest += 1;
                        cursor_b += 1;
                        nof_wins_b += 1;
                        length_b -= 1;
                        nof_wins_a = 0;
                        if length_b == 0 {
                            break 'merge MergeExit::Succeed;
                        }
                        if nof_wins_b >= min_gallop {
                            break;
                        }
                    } else {
                        self.work[dest as usize] = at(&self.temp, cursor_temp);
                        dest += 1;
                        cursor_temp += 1;
                        nof_wins_a += 1;
                        length_a -= 1;
                        nof_wins_b = 0;
                        if length_a == 1 {
                            break 'merge MergeExit::CopyRest;
                        }
                        if nof_wins_a >= min_gallop {
                            break;
                        }
                    }
                }
                // Galloping until neither run wins consistently.
                min_gallop += 1;
                let mut first_iteration = true;
                while nof_wins_a >= MIN_GALLOP_WINS
                    || nof_wins_b >= MIN_GALLOP_WINS
                    || first_iteration
                {
                    first_iteration = false;
                    min_gallop = 1.max(min_gallop - 1);
                    self.min_gallop = min_gallop;

                    let key = at(&self.work, cursor_b);
                    nof_wins_a = gallop_right(cmp, &self.temp, key, cursor_temp, length_a, 0);
                    if nof_wins_a > 0 {
                        self.copy_temp_to_work(cursor_temp, dest, nof_wins_a);
                        dest += nof_wins_a;
                        cursor_temp += nof_wins_a;
                        length_a -= nof_wins_a;
                        if length_a == 1 {
                            break 'merge MergeExit::CopyRest;
                        }
                        // lengthA == 0 is impossible now if the comparison
                        // function is consistent, but we can't assume that.
                        if length_a == 0 {
                            break 'merge MergeExit::Succeed;
                        }
                    }
                    self.work[dest as usize] = at(&self.work, cursor_b);
                    dest += 1;
                    cursor_b += 1;
                    length_b -= 1;
                    if length_b == 0 {
                        break 'merge MergeExit::Succeed;
                    }

                    let key = at(&self.temp, cursor_temp);
                    nof_wins_b = gallop_left(cmp, &self.work, key, cursor_b, length_b, 0);
                    if nof_wins_b > 0 {
                        self.copy_work(cursor_b, dest, nof_wins_b);
                        dest += nof_wins_b;
                        cursor_b += nof_wins_b;
                        length_b -= nof_wins_b;
                        if length_b == 0 {
                            break 'merge MergeExit::Succeed;
                        }
                    }
                    self.work[dest as usize] = at(&self.temp, cursor_temp);
                    dest += 1;
                    cursor_temp += 1;
                    length_a -= 1;
                    if length_a == 1 {
                        break 'merge MergeExit::CopyRest;
                    }
                }
                min_gallop += 1; // Penalize it for leaving galloping mode
                self.min_gallop = min_gallop;
            }
        };
        match exit {
            MergeExit::Succeed => {
                if length_a > 0 {
                    self.copy_temp_to_work(cursor_temp, dest, length_a);
                }
            }
            MergeExit::CopyRest => {
                // The last element of run A belongs at the end of the merge.
                self.copy_work(cursor_b, dest, length_b);
                self.work[(dest + length_b) as usize] = at(&self.temp, cursor_temp);
            }
        }
    }

    /// `MergeHigh`: merge with a copy of run B (the shorter) in the temp
    /// array, back to front.
    fn merge_high(
        &mut self,
        cmp: &mut impl FnMut(usize, usize) -> f64,
        base_a: isize,
        length_a_arg: isize,
        base_b: isize,
        length_b_arg: isize,
    ) {
        let mut length_a = length_a_arg;
        let mut length_b = length_b_arg;
        self.ensure_temp(length_b);
        let (b0, lb) = (base_b as usize, length_b as usize);
        self.temp[..lb].copy_from_slice(&self.work[b0..b0 + lb]);

        let mut dest = base_b + length_b - 1;
        let mut cursor_temp = length_b - 1;
        let mut cursor_a = base_a + length_a - 1;

        self.work[dest as usize] = at(&self.work, cursor_a);
        dest -= 1;
        cursor_a -= 1;

        let exit = 'merge: {
            length_a -= 1;
            if length_a == 0 {
                break 'merge MergeExit::Succeed;
            }
            if length_b == 1 {
                break 'merge MergeExit::CopyRest;
            }
            let mut min_gallop = self.min_gallop;
            loop {
                let mut nof_wins_a: isize = 0;
                let mut nof_wins_b: isize = 0;
                loop {
                    let order = cmp(at(&self.temp, cursor_temp), at(&self.work, cursor_a));
                    if order < 0.0 {
                        self.work[dest as usize] = at(&self.work, cursor_a);
                        dest -= 1;
                        cursor_a -= 1;
                        nof_wins_a += 1;
                        length_a -= 1;
                        nof_wins_b = 0;
                        if length_a == 0 {
                            break 'merge MergeExit::Succeed;
                        }
                        if nof_wins_a >= min_gallop {
                            break;
                        }
                    } else {
                        self.work[dest as usize] = at(&self.temp, cursor_temp);
                        dest -= 1;
                        cursor_temp -= 1;
                        nof_wins_b += 1;
                        length_b -= 1;
                        nof_wins_a = 0;
                        if length_b == 1 {
                            break 'merge MergeExit::CopyRest;
                        }
                        if nof_wins_b >= min_gallop {
                            break;
                        }
                    }
                }
                min_gallop += 1;
                let mut first_iteration = true;
                while nof_wins_a >= MIN_GALLOP_WINS
                    || nof_wins_b >= MIN_GALLOP_WINS
                    || first_iteration
                {
                    first_iteration = false;
                    min_gallop = 1.max(min_gallop - 1);
                    self.min_gallop = min_gallop;

                    let key = at(&self.temp, cursor_temp);
                    let k = gallop_right(cmp, &self.work, key, base_a, length_a, length_a - 1);
                    nof_wins_a = length_a - k;
                    if nof_wins_a > 0 {
                        dest -= nof_wins_a;
                        cursor_a -= nof_wins_a;
                        self.copy_work(cursor_a + 1, dest + 1, nof_wins_a);
                        length_a -= nof_wins_a;
                        if length_a == 0 {
                            break 'merge MergeExit::Succeed;
                        }
                    }
                    self.work[dest as usize] = at(&self.temp, cursor_temp);
                    dest -= 1;
                    cursor_temp -= 1;
                    length_b -= 1;
                    if length_b == 1 {
                        break 'merge MergeExit::CopyRest;
                    }

                    let key = at(&self.work, cursor_a);
                    let k = gallop_left(cmp, &self.temp, key, 0, length_b, length_b - 1);
                    nof_wins_b = length_b - k;
                    if nof_wins_b > 0 {
                        dest -= nof_wins_b;
                        cursor_temp -= nof_wins_b;
                        self.copy_temp_to_work(cursor_temp + 1, dest + 1, nof_wins_b);
                        length_b -= nof_wins_b;
                        if length_b == 1 {
                            break 'merge MergeExit::CopyRest;
                        }
                        // lengthB == 0 is impossible now if the comparison
                        // function is consistent, but we can't assume that.
                        if length_b == 0 {
                            break 'merge MergeExit::Succeed;
                        }
                    }
                    self.work[dest as usize] = at(&self.work, cursor_a);
                    dest -= 1;
                    cursor_a -= 1;
                    length_a -= 1;
                    if length_a == 0 {
                        break 'merge MergeExit::Succeed;
                    }
                }
                min_gallop += 1;
                self.min_gallop = min_gallop;
            }
        };
        match exit {
            MergeExit::Succeed => {
                if length_b > 0 {
                    self.copy_temp_to_work(0, dest - (length_b - 1), length_b);
                }
            }
            MergeExit::CopyRest => {
                // The first element of run B belongs at the front of the merge.
                dest -= length_a;
                cursor_a -= length_a;
                self.copy_work(cursor_a + 1, dest + 1, length_a);
                self.work[dest as usize] = at(&self.temp, cursor_temp);
            }
        }
    }

    fn run_length(&self, n: isize) -> isize {
        self.pending[n as usize].1
    }

    /// `RunInvariantEstablished(n)`: run(n - 2) > run(n - 1) + run(n).
    fn run_invariant_established(&self, n: isize) -> bool {
        if n < 2 {
            return true;
        }
        self.run_length(n - 2) > self.run_length(n - 1) + self.run_length(n)
    }

    /// `MergeCollapse`: merge until the stack invariants hold again.
    fn merge_collapse(&mut self, cmp: &mut impl FnMut(usize, usize) -> f64) {
        while self.pending.len() > 1 {
            let mut n = self.pending.len() as isize - 2;
            if !self.run_invariant_established(n + 1) || !self.run_invariant_established(n) {
                if self.run_length(n - 1) < self.run_length(n + 1) {
                    n -= 1;
                }
                self.merge_at(cmp, n as usize);
            } else if self.run_length(n) <= self.run_length(n + 1) {
                self.merge_at(cmp, n as usize);
            } else {
                break;
            }
        }
    }

    /// `MergeForceCollapse`: merge all runs into one.
    fn merge_force_collapse(&mut self, cmp: &mut impl FnMut(usize, usize) -> f64) {
        while self.pending.len() > 1 {
            let mut n = self.pending.len() as isize - 2;
            if n > 0 && self.run_length(n - 1) < self.run_length(n + 1) {
                n -= 1;
            }
            self.merge_at(cmp, n as usize);
        }
    }
}

/// `xs.reduce((s, x) => s + x, 0)`: a left fold from +0 (std's `Sum` starts
/// at -0).
pub fn sum(xs: impl IntoIterator<Item = f64>) -> f64 {
    xs.into_iter().fold(0.0, |s, x| s + x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_numbers_and_keeps_equal_elements_in_order() {
        let mut v = vec![(3.0, 0), (1.0, 1), (3.0, 2), (2.0, 3), (1.0, 4)];
        sort_by(&mut v, |a, b| a.0 - b.0);
        assert_eq!(v, vec![(1.0, 1), (1.0, 4), (2.0, 3), (3.0, 0), (3.0, 2)]);
    }

    #[test]
    fn nan_comparisons_never_panic() {
        // An inconsistent comparator (NaN keys) on arrays long enough for
        // merges and galloping.
        let mut s: u64 = 7;
        for n in [2usize, 31, 64, 65, 200, 1000, 5000] {
            let mut v: Vec<f64> = (0..n)
                .map(|_| {
                    s = s
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    if s >> 61 == 0 {
                        f64::NAN
                    } else {
                        (s >> 40) as f64
                    }
                })
                .collect();
            let mut sorted = v.clone();
            sort_by(&mut sorted, |a, b| a - b);
            // a permutation of the input
            let key = |x: &f64| x.to_bits();
            v.sort_by_key(key);
            sorted.sort_by_key(key);
            assert_eq!(
                v.iter().map(key).collect::<Vec<_>>(),
                sorted.iter().map(key).collect::<Vec<_>>()
            );
        }
    }
}
