#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_WAIT_TIMEOUT: Duration = Duration::from_secs(20);

struct BackendProcess(Mutex<Option<CommandChild>>);

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
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let port = reserve_backend_port()?;
            let api_base = format!("http://{BACKEND_HOST}:{port}");

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
                .env("MAI_PORT", port.to_string());

            if let Ok(resource_dir) = app.path().resource_dir() {
                let frontend_dist = resource_dir.join("frontend-dist");
                if frontend_dist.join("index.html").is_file() {
                    backend = backend.env("MAI_FRONTEND_DIST", frontend_dist.to_string_lossy().to_string());
                }
            }

            let (mut rx, child) = backend.spawn()?;
            app.manage(BackendProcess(Mutex::new(Some(child))));

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[mai-backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[mai-backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[mai-backend] terminated: {status:?}");
                        }
                        _ => {}
                    }
                }
            });

            wait_for_backend(port).map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;

            let init_script = format!("window.__MAI_API_BASE__ = \"{api_base}\";");
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
