//! Replay / dedup protection + per-peer rate limiting (#54).
//!
//! Gossip floods messages, so every node sees duplicates and must be cheap to
//! re-receive. `SeenSet` is a bounded FIFO of message ids: a message id seen
//! before is dropped without reprocessing or re-broadcast amplification, and the
//! set never grows past `capacity` (oldest ids evicted). `RateLimiter` bounds how
//! many messages a single peer can introduce per window (anti-spam).

use std::collections::{HashMap, HashSet, VecDeque};

/// Bounded set of recently-seen message ids (FIFO eviction).
pub struct SeenSet {
    set: HashSet<String>,
    order: VecDeque<String>,
    capacity: usize,
}

impl SeenSet {
    pub fn new(capacity: usize) -> Self {
        Self {
            set: HashSet::new(),
            order: VecDeque::new(),
            capacity: capacity.max(1),
        }
    }

    /// Record an id. Returns true if it is NEW (caller should process it), false
    /// if already seen (caller should drop it).
    pub fn observe(&mut self, id: &str) -> bool {
        if self.set.contains(id) {
            return false;
        }
        if self.order.len() >= self.capacity {
            if let Some(old) = self.order.pop_front() {
                self.set.remove(&old);
            }
        }
        self.set.insert(id.to_string());
        self.order.push_back(id.to_string());
        true
    }

    pub fn len(&self) -> usize {
        self.set.len()
    }

    pub fn is_empty(&self) -> bool {
        self.set.is_empty()
    }
}

/// Fixed-window per-key rate limiter (e.g. keyed by peer id). Time is injected so
/// it is deterministic and offline-testable.
pub struct RateLimiter {
    max_per_window: u32,
    window_secs: u64,
    state: HashMap<String, (u64, u32)>, // key → (window_start, count)
}

impl RateLimiter {
    pub fn new(max_per_window: u32, window_secs: u64) -> Self {
        Self {
            max_per_window,
            window_secs: window_secs.max(1),
            state: HashMap::new(),
        }
    }

    /// Returns true if `key` is allowed one more message at `now_secs`.
    pub fn allow(&mut self, key: &str, now_secs: u64) -> bool {
        let entry = self.state.entry(key.to_string()).or_insert((now_secs, 0));
        if now_secs.saturating_sub(entry.0) >= self.window_secs {
            *entry = (now_secs, 0);
        }
        if entry.1 >= self.max_per_window {
            return false;
        }
        entry.1 += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_observation_is_new_repeat_is_not() {
        let mut s = SeenSet::new(8);
        assert!(s.observe("a"));
        assert!(!s.observe("a"));
        assert!(s.observe("b"));
    }

    #[test]
    fn evicts_oldest_beyond_capacity() {
        let mut s = SeenSet::new(2);
        s.observe("a");
        s.observe("b");
        s.observe("c"); // evicts "a"
        assert_eq!(s.len(), 2);
        assert!(s.observe("a")); // "a" was evicted ⇒ treated as new again
    }

    #[test]
    fn capacity_is_never_exceeded() {
        let mut s = SeenSet::new(3);
        for i in 0..100 {
            s.observe(&format!("id{i}"));
            assert!(s.len() <= 3);
        }
    }

    #[test]
    fn rate_limiter_blocks_within_window_and_resets_after() {
        let mut r = RateLimiter::new(2, 60);
        assert!(r.allow("peer", 0));
        assert!(r.allow("peer", 10));
        assert!(!r.allow("peer", 20)); // 3rd in window blocked
        assert!(r.allow("peer", 61)); // new window
    }

    #[test]
    fn rate_limiter_is_per_key() {
        let mut r = RateLimiter::new(1, 60);
        assert!(r.allow("p1", 0));
        assert!(r.allow("p2", 0)); // independent budget
        assert!(!r.allow("p1", 0));
    }
}
