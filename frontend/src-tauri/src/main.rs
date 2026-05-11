#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_WAIT_TIMEOUT: Duration = Duration::from_secs(20);

struct BackendProcess(Mutex<Option<CommandChild>>);

#[derive(Clone, Serialize)]
struct BackendErrorPayload {
    message: String,
    log_dir: String,
}

fn logs_dir(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata).join("MAI").join("logs");
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("MAI"))
        .join("logs")
}

fn ensure_log_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

fn timestamp_ms() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("{}.{:03}", duration.as_secs(), duration.subsec_millis()),
        Err(_) => "0.000".to_string(),
    }
}

fn append_log_line(path: &Path, channel: &str, message: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        ensure_log_dir(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    let clean = message.trim_end_matches(['\r', '\n']);
    writeln!(file, "[{}] {channel}: {clean}", timestamp_ms())
}

#[tauri::command]
fn get_log_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = logs_dir(&app);
    ensure_log_dir(&dir).map_err(|err| err.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = logs_dir(&app);
    ensure_log_dir(&dir).map_err(|err| err.to_string())?;
    open_path(&dir).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_frontend_log(app: tauri::AppHandle, message: String) -> Result<(), String> {
    let path = logs_dir(&app).join("frontend.log");
    let clipped: String = message.chars().take(8_000).collect();
    append_log_line(&path, "frontend", &clipped).map_err(|err| err.to_string())
}

fn open_path(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(path).spawn()?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
        return Ok(());
    }
}

fn reserve_backend_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind((BACKEND_HOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn backend_is_healthy(port: u16) -> bool {
    let address = format!("{BACKEND_HOST}:{port}");
    let timeout = Duration::from_millis(250);
    let Ok(mut stream) = TcpStream::connect_timeout(&address.parse().unwrap(), timeout) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!("GET /health HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buffer = [0_u8; 256];
    match stream.read(&mut buffer) {
        Ok(read) => String::from_utf8_lossy(&buffer[..read]).contains("200 OK"),
        Err(_) => false,
    }
}

fn wait_for_backend(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + BACKEND_WAIT_TIMEOUT;
    while Instant::now() < deadline {
        if backend_is_healthy(port) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err(format!(
        "MAI backend did not become healthy on http://{BACKEND_HOST}:{port}"
    ))
}

fn stop_backend(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<BackendProcess>() else {
        return;
    };
    if let Ok(mut child) = state.0.lock() {
        if let Some(child) = child.take() {
            let _ = child.kill();
        }
    };
}

fn main() {
    tauri::Builder::default()
        // single-instance must be registered first so a duplicate launch is
        // intercepted before we spawn another sidecar (which would race with
        // the existing one for the backend port and write-lock the SQLite DB).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_log_dir,
            open_log_dir,
            write_frontend_log
        ])
        .setup(|app| {
            let port = reserve_backend_port()?;
            let api_base = format!("http://{BACKEND_HOST}:{port}");
            let app_handle = app.handle().clone();
            let log_dir = logs_dir(&app_handle);
            ensure_log_dir(&log_dir)?;
            let backend_log = log_dir.join("backend.log");
            let frontend_log = log_dir.join("frontend.log");
            append_log_line(&frontend_log, "desktop", "MAI desktop shell starting")?;
            append_log_line(
                &backend_log,
                "desktop",
                &format!("starting backend sidecar on {api_base}"),
            )?;

            let mut backend = app
                .shell()
                .sidecar("mai-backend")?
                .arg("--host")
                .arg(BACKEND_HOST)
                .arg("--port")
                .arg(port.to_string())
                .arg("--log-level")
                .arg("warning")
                .env("MAI_PACKAGED", "1")
                .env("MAI_HOST", BACKEND_HOST)
                .env("MAI_PORT", port.to_string())
                .env("MAI_LOG_DIR", log_dir.to_string_lossy().to_string());

            if let Ok(resource_dir) = app.path().resource_dir() {
                let frontend_dist = resource_dir.join("frontend-dist");
                if frontend_dist.join("index.html").is_file() {
                    backend = backend.env("MAI_FRONTEND_DIST", frontend_dist.to_string_lossy().to_string());
                }
            }

            let (mut rx, child) = backend.spawn()?;
            app.manage(BackendProcess(Mutex::new(Some(child))));

            let event_app = app.handle().clone();
            let event_log_dir = log_dir.clone();
            let event_backend_log = backend_log.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let text = String::from_utf8_lossy(&line).to_string();
                            let _ = append_log_line(&event_backend_log, "stdout", &text);
                            println!("[mai-backend] {text}");
                        }
                        CommandEvent::Stderr(line) => {
                            let text = String::from_utf8_lossy(&line).to_string();
                            let _ = append_log_line(&event_backend_log, "stderr", &text);
                            eprintln!("[mai-backend] {text}");
                        }
                        CommandEvent::Terminated(status) => {
                            let message = format!("MAI backend terminated: {status:?}");
                            let _ = append_log_line(&event_backend_log, "terminated", &message);
                            let _ = event_app.emit(
                                "mai://backend-terminated",
                                BackendErrorPayload {
                                    message: message.clone(),
                                    log_dir: event_log_dir.to_string_lossy().to_string(),
                                },
                            );
                            eprintln!("[mai-backend] {message}");
                        }
                        _ => {}
                    }
                }
            });

            let startup_error = match wait_for_backend(port) {
                Ok(()) => {
                    append_log_line(&backend_log, "desktop", "backend health check passed")?;
                    None
                }
                Err(err) => {
                    append_log_line(&backend_log, "startup_error", &err)?;
                    Some(err)
                }
            };

            let init_script = format!(
                "window.__MAI_API_BASE__ = {}; window.__MAI_LOG_DIR__ = {}; window.__MAI_BACKEND_STARTUP_ERROR__ = {};",
                serde_json::to_string(&api_base)?,
                serde_json::to_string(&log_dir.to_string_lossy().to_string())?,
                serde_json::to_string(&startup_error)?,
            );
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("MAI")
                .inner_size(1280.0, 820.0)
                .min_inner_size(980.0, 640.0)
                .resizable(true)
                .initialization_script(init_script)
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building MAI desktop shell")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_backend(app),
            _ => {}
        });
}
