use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessesToUpdate, System};

// Persistent System instance instead of a fresh one per call. sysinfo needs
// ~200ms between refreshes to get a real CPU% delta, and the frontend
// polls every few seconds so reusing one instance covers that.
pub struct PerfState(pub Mutex<System>);

impl Default for PerfState {
    fn default() -> Self {
        PerfState(Mutex::new(System::new()))
    }
}

#[derive(Serialize)]
pub struct PerfStats {
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub uptime_secs: u64,
    pub pid: u32,
}

#[tauri::command]
pub fn get_perf_stats(state: tauri::State<'_, PerfState>) -> Option<PerfStats> {
    let pid = Pid::from_u32(std::process::id());
    let mut sys = state.0.lock().unwrap();
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    let process = sys.process(pid)?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Some(PerfStats {
        cpu_percent: process.cpu_usage(),
        memory_bytes: process.memory(),
        uptime_secs: now.saturating_sub(process.start_time()),
        pid: pid.as_u32(),
    })
}
