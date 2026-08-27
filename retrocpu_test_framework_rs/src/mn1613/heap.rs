use crate::error::FrameworkError;

pub const MN1613_USER_HEAP_START: u16 = 0x1800;
pub const MN1613_USER_HEAP_END: u16 = 0xf800;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MallocSettings {
    pub start: Option<u16>,
    pub words: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MallocRange {
    pub start_word: u16,
    pub end_word: u32,
    pub words: u32,
}

pub fn resolve_malloc_range(malloc: Option<MallocSettings>) -> Result<MallocRange, FrameworkError> {
    let start = malloc
        .and_then(|m| m.start)
        .unwrap_or(MN1613_USER_HEAP_START) as u32;
    if start > 0xffff {
        return Err(FrameworkError::invalid_argument(format!(
            "malloc.start: invalid word address {start}"
        )));
    }

    let words = malloc
        .and_then(|m| m.words)
        .unwrap_or(MN1613_USER_HEAP_END as u32 - start);
    if words < 1 {
        return Err(FrameworkError::invalid_argument(format!(
            "malloc.words: must be >= 1, got {words}"
        )));
    }

    let end_word = start + words;
    if end_word > 0x1_0000 {
        return Err(FrameworkError::invalid_argument(format!(
            "malloc: start 0x{:04X} + words {} exceeds 16bit space",
            start, words
        )));
    }

    Ok(MallocRange {
        start_word: start as u16,
        end_word,
        words,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HeapSpan {
    start: u16,
    size: u32,
    used: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WordHeap {
    lo: u16,
    hi: u32,
    spans: Vec<HeapSpan>,
}

fn hex4(n: u16) -> String {
    format!("{:04X}", n)
}

impl WordHeap {
    pub fn new(start_word: u16, end_word: u32) -> Result<Self, FrameworkError> {
        let start = start_word as u32;
        if end_word <= start || end_word > 0x1_0000 {
            return Err(FrameworkError::invalid_argument(format!(
                "WordHeap: end {end_word} must be > start {start} and <= 0x10000"
            )));
        }

        let mut out = Self {
            lo: start_word,
            hi: end_word,
            spans: Vec::new(),
        };
        out.reset();
        Ok(out)
    }

    pub fn with_default_range() -> Result<Self, FrameworkError> {
        Self::new(MN1613_USER_HEAP_START, MN1613_USER_HEAP_END as u32)
    }

    pub fn start_word(&self) -> u16 {
        self.lo
    }

    pub fn end_word(&self) -> u32 {
        self.hi
    }

    pub fn reset(&mut self) {
        self.spans.clear();
        self.spans.push(HeapSpan {
            start: self.lo,
            size: self.hi - self.lo as u32,
            used: false,
        });
    }

    pub fn malloc(&mut self, word_count: u32) -> Result<u16, FrameworkError> {
        if word_count < 1 {
            return Err(FrameworkError::invalid_argument(format!(
                "malloc: word_count must be >= 1, got {word_count}"
            )));
        }

        for i in 0..self.spans.len() {
            let span = self.spans[i];
            if span.used || span.size < word_count {
                continue;
            }

            if span.size == word_count {
                self.spans[i].used = true;
                return Ok(span.start);
            }

            self.spans.splice(
                i..=i,
                [
                    HeapSpan {
                        start: span.start,
                        size: word_count,
                        used: true,
                    },
                    HeapSpan {
                        start: span.start.wrapping_add(word_count as u16),
                        size: span.size - word_count,
                        used: false,
                    },
                ],
            );
            return Ok(span.start);
        }

        Err(FrameworkError::invalid_argument(format!(
            "malloc: out of heap ({} words, 0x{}-0x{:04X})",
            word_count,
            hex4(self.lo),
            self.hi
        )))
    }

    pub fn free(&mut self, word_addr: u16) -> Result<(), FrameworkError> {
        let pos = self
            .spans
            .iter()
            .position(|s| s.start == word_addr && s.used)
            .ok_or_else(|| {
                FrameworkError::invalid_argument(format!(
                    "free: not an allocated block: 0x{}",
                    hex4(word_addr)
                ))
            })?;

        self.spans[pos].used = false;
        self.coalesce();
        Ok(())
    }

    pub fn size_of(&self, word_addr: u16) -> Result<u32, FrameworkError> {
        self.spans
            .iter()
            .find(|s| s.start == word_addr && s.used)
            .map(|s| s.size)
            .ok_or_else(|| {
                FrameworkError::invalid_argument(format!(
                    "size_of: not an allocated block: 0x{}",
                    hex4(word_addr)
                ))
            })
    }

    pub fn is_allocated(&self, word_addr: u16) -> bool {
        self.spans.iter().any(|s| s.start == word_addr && s.used)
    }

    fn coalesce(&mut self) {
        let mut out: Vec<HeapSpan> = Vec::with_capacity(self.spans.len());
        for span in &self.spans {
            if let Some(last) = out.last_mut() {
                if !last.used && !span.used {
                    last.size += span.size;
                } else {
                    out.push(*span);
                }
            } else {
                out.push(*span);
            }
        }
        self.spans = out;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_range_defaults() {
        let r = resolve_malloc_range(None).expect("default range should work");
        assert_eq!(r.start_word, MN1613_USER_HEAP_START);
        assert_eq!(r.end_word, MN1613_USER_HEAP_END as u32);
    }

    #[test]
    fn heap_alloc_free_cycle() {
        let mut h = WordHeap::new(0x1800, 0x1810).expect("heap should be created");
        let a = h.malloc(4).expect("alloc A");
        let b = h.malloc(2).expect("alloc B");
        assert_eq!(a, 0x1800);
        assert_eq!(b, 0x1804);
        assert!(h.is_allocated(a));
        assert_eq!(h.size_of(b).expect("size of B"), 2);
        h.free(a).expect("free A");
        assert!(!h.is_allocated(a));
    }
}
