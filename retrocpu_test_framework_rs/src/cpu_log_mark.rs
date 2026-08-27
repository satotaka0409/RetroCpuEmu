use std::sync::{Arc, Mutex, OnceLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CpuLogTestPhase {
    Start,
    End,
}

pub trait CpuLogMarker: Send + Sync {
    fn append_test_mark(&self, name: &str, phase: CpuLogTestPhase);
}

#[derive(Default)]
struct CpuLogMarkState {
    active: Option<Arc<dyn CpuLogMarker>>,
    pending_name: Option<String>,
}

fn state() -> &'static Mutex<CpuLogMarkState> {
    static STATE: OnceLock<Mutex<CpuLogMarkState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(CpuLogMarkState::default()))
}

pub fn set_active_cpu_log_marker(marker: Option<Arc<dyn CpuLogMarker>>) {
    if let Ok(mut st) = state().lock() {
        st.active = marker;
    }
}

pub fn clear_cpu_log_test_mark() {
    if let Ok(mut st) = state().lock() {
        st.active = None;
        st.pending_name = None;
    }
}

pub fn begin_cpu_log_test(name: &str) {
    if let Ok(mut st) = state().lock() {
        st.pending_name = Some(name.to_string());
        if let Some(active) = st.active.clone() {
            active.append_test_mark(name, CpuLogTestPhase::Start);
        }
    }
}

pub fn end_cpu_log_test(name: &str) {
    if let Ok(mut st) = state().lock() {
        if let Some(active) = st.active.clone() {
            active.append_test_mark(name, CpuLogTestPhase::End);
        }
        st.pending_name = None;
    }
}

pub fn take_pending_cpu_log_test_name() -> Option<String> {
    if let Ok(mut st) = state().lock() {
        return st.pending_name.take();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct MockMarker {
        marks: Mutex<Vec<String>>,
    }

    impl CpuLogMarker for MockMarker {
        fn append_test_mark(&self, name: &str, phase: CpuLogTestPhase) {
            let p = match phase {
                CpuLogTestPhase::Start => "START",
                CpuLogTestPhase::End => "END",
            };
            self.marks.lock().expect("lock").push(format!("{name}:{p}"));
        }
    }

    #[test]
    fn begin_end_write_marks_and_pending_name() {
        clear_cpu_log_test_mark();
        let marker = Arc::new(MockMarker::default());
        set_active_cpu_log_marker(Some(marker.clone()));

        begin_cpu_log_test("case_a");
        assert_eq!(take_pending_cpu_log_test_name(), Some("case_a".to_string()));
        end_cpu_log_test("case_a");

        let marks = marker.marks.lock().expect("lock").clone();
        assert_eq!(marks, vec!["case_a:START", "case_a:END"]);
    }
}
