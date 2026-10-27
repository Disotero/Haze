//! The line protocol both modes speak: one JSON object per line on stdout
//! (flushed immediately), one command per line on stdin. EOF on stdin is how
//! psbridge stops the helper — the process must exit right away.
//
// Wake is only used by the Windows modules; host test builds never touch it.
#![cfg_attr(not(windows), allow(dead_code))]

use std::io::{BufRead, Write};
use std::sync::{mpsc, Arc, Mutex};

/// Write one JSON line to stdout and flush it.
pub fn emit(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

/// Read stdin on a worker thread and forward every non-empty line to `tx`,
/// mapped by `convert`. EOF (parent closed the pipe) or a dead receiver
/// exits the whole process immediately — a clean exit, no unwinding needed.
pub fn spawn_stdin<T, F>(tx: mpsc::Sender<T>, convert: F)
where
    T: Send + 'static,
    F: Fn(String) -> T + Send + 'static,
{
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut lines = stdin.lock().lines();
        loop {
            match lines.next() {
                Some(Ok(line)) => {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if tx.send(convert(line.to_string())).is_err() {
                        break;
                    }
                }
                // EOF or a read error: the parent is done with us.
                _ => break,
            }
        }
        std::process::exit(0);
    });
}

/// A channel sender wrapped for `Sync`: COM and WinRT callbacks arrive on
/// threads we do not own, and `mpsc::Sender` alone is not `Sync`. Every
/// event source holds a `Wake` clone and only ever sends.
pub struct Wake<T>(Arc<Mutex<mpsc::Sender<T>>>);

// Manual impl: the derived one would require T: Clone, which messages are
// not required to be.
impl<T> Clone for Wake<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T> Wake<T> {
    pub fn new(tx: mpsc::Sender<T>) -> Self {
        Self(Arc::new(Mutex::new(tx)))
    }

    /// Never blocks and never panics: if the owner loop is gone, the helper
    /// is shutting down anyway.
    pub fn send(&self, msg: T) {
        if let Ok(tx) = self.0.lock() {
            let _ = tx.send(msg);
        }
    }
}
