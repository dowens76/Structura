use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

// ── Helper: find a free TCP port ──────────────────────────────────────────────

fn find_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind to a port");
    listener.local_addr().unwrap().port()
}

// ── Tauri command: native folder picker ───────────────────────────────────────

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });
    rx.recv().ok().flatten()
}

// ── Tauri command: native save-file dialog + write ────────────────────────────
//
// Called from the frontend export toolbar for PNG (and any future binary
// export formats).  The frontend passes a base64 data-URL; this command
// strips the header, decodes the bytes, shows the native save dialog, and
// writes the file to whatever path the user picked.  Returns `true` if the
// file was saved, `false` if the user cancelled.

#[tauri::command]
async fn save_file(
    app: AppHandle,
    filename: String,
    data_url: String,
    filter_name: String,
    ext: String,
) -> Result<bool, String> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;

    // Strip "data:<mime>;base64," prefix
    let b64 = data_url
        .split(',')
        .nth(1)
        .ok_or_else(|| "Invalid data URL: missing comma separator".to_string())?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Base64 decode error: {e}"))?;

    // Show native save dialog
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_file_name(&filename)
        .add_filter(&filter_name, &[ext.as_str()])
        .save_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });

    match rx.recv().ok().flatten() {
        Some(path) => {
            std::fs::write(&path, &bytes)
                .map_err(|e| format!("Failed to write {path}: {e}"))?;
            log::info!("Saved export file to {path}");
            Ok(true)
        }
        None => {
            log::info!("Save file dialog cancelled by user");
            Ok(false)
        }
    }
}

// ── First-run: copy user.db.template → appDataDir/user.db ───────────────────

fn ensure_user_db(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let user_db = app_data.join("user.db");
    if !user_db.exists() {
        let template = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("user.db.template")
        } else {
            app.path()
                .resource_dir()
                .map_err(|e| format!("Failed to resolve resource dir: {e}"))?
                .join("user.db.template")
        };
        if template.exists() {
            std::fs::copy(&template, &user_db)
                .map_err(|e| format!("Failed to copy user.db.template: {e}"))?;
            log::info!("First run: created user.db from template");
        } else {
            log::warn!("user.db.template not found — user.db will be created fresh by the app");
        }
    }
    Ok(user_db)
}

// ── Spawn Next.js sidecar ─────────────────────────────────────────────────────

fn spawn_server(app: &AppHandle, port: u16) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    // In debug mode, use the source tree directly (resources aren't reliably
    // synced to target/debug/ during `tauri dev`). In release, use the bundle.
    let server_dir = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("server")
    } else {
        resource_dir.join("server")
    };

    // In dev mode, use the project root's data/ directory to avoid
    // triggering Tauri's file watcher with SQLite WAL changes in src-tauri/.
    // In release, databases live in the app bundle's resource dir.
    let databases_dir = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("data"))
            .unwrap_or_else(|| resource_dir.join("databases"))
    } else {
        resource_dir.join("databases")
    };

    log::info!("Spawning Next.js server on port {port}");
    log::info!("  server_dir:    {}", server_dir.display());
    log::info!("  databases_dir: {}", databases_dir.display());
    log::info!("  app_data_dir:  {}", app_data_dir.display());

    let sidecar = app
        .shell()
        .sidecar("node")
        .map_err(|e| format!("Failed to create node sidecar: {e}"))?
        .args(["server.js"])
        .current_dir(&server_dir)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("STRUCTURA_RESOURCES_DIR", databases_dir.to_string_lossy().to_string())
        .env("STRUCTURA_USER_DATA_DIR", app_data_dir.to_string_lossy().to_string())
        // Next.js standalone needs to know where to find .next/static
        .env("NEXT_SHARP_PATH", "")
        ;

    let (mut rx, _child) = sidecar.spawn().map_err(|e| format!("Failed to spawn node sidecar: {e}"))?;

    let app_handle = app.clone();
    let ready_url = format!("http://127.0.0.1:{port}");
    let navigated = Arc::new(Mutex::new(false));

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    log::info!("[node] {}", text.trim());
                    // Navigate WebView once server is ready.
                    // Next.js standalone prints "✓ Ready in Nms" to stdout.
                    let mut nav = navigated.lock().unwrap();
                    if !*nav && (text.contains("Ready") || text.contains("Listening on") || text.contains("started server")) {
                        *nav = true;
                        drop(nav);
                        log::info!("Server ready — navigating to {ready_url}");
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.navigate(ready_url.parse().unwrap());
                        }
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    log::warn!("[node stderr] {}", text.trim());
                    // Next.js 16 prints "▲ Next.js ... Ready" to stderr
                    let mut nav = navigated.lock().unwrap();
                    if !*nav && (text.contains("Ready") || text.contains("started server")) {
                        *nav = true;
                        drop(nav);
                        log::info!("Server ready (stderr) — navigating to {ready_url}");
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.navigate(ready_url.parse().unwrap());
                        }
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Error(err) => {
                    log::error!("[node error] {err}");
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                    log::error!("[node] Process terminated: {:?}", status);
                }
                _ => {}
            }
        }
    });

    Ok(())
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Ensure user.db exists (first-run copy from template)
            if let Err(e) = ensure_user_db(app.handle()) {
                log::error!("ensure_user_db failed: {e}");
            }

            // Find a free port and spawn the Next.js sidecar
            let port = find_free_port();
            if let Err(e) = spawn_server(app.handle(), port) {
                log::error!("spawn_server failed: {e}");
                // Show a native error dialog so the user knows what went wrong
                use tauri_plugin_dialog::DialogExt;
                app.dialog()
                    .message(format!("Failed to start server:\n\n{e}"))
                    .title("Structura — Startup Error")
                    .show(|_| {});
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pick_folder, save_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
