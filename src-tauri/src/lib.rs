use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

// ── Helper: find a TCP port ───────────────────────────────────────────────────

/// Try the preferred port first so the URL is predictable (http://localhost:3737).
/// Falls back to any OS-assigned free port if 3737 is already in use.
fn find_preferred_port(preferred: u16) -> u16 {
    if TcpListener::bind(format!("127.0.0.1:{preferred}")).is_ok() {
        preferred
    } else {
        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind to a port");
        listener.local_addr().unwrap().port()
    }
}

// ── Tauri command: open print dialog ─────────────────────────────────────────
//
// window.print() is ignored by WKWebView on macOS.  This command calls the
// native print API on the main window instead.

#[tauri::command]
async fn print_page(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.print().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Tauri command: capture current viewport as PNG ───────────────────────────
//
// Called from the ExportLayout PNG path as part of a scroll-and-stitch
// pipeline.  Uses WKWebView's native takeSnapshot() API — the same full HTML
// renderer used to display the page — so custom fonts (Ezra SIL, Gentium Plus),
// BiDi text shaping, and SVG overlays all render exactly as seen on screen.
// JavaScript scrolls through the content in viewport-sized strips and composites
// the base64 PNG strips onto a single canvas to reconstruct the full page.
//
// macOS implementation: dispatches to the main thread via with_webview(), calls
// WKWebView.takeSnapshotWithConfiguration(_:completionHandler:), converts the
// returned NSImage to PNG bytes via NSBitmapImageRep, and pipes the result back
// to the command thread through an mpsc channel.

#[cfg(target_os = "macos")]
#[tauri::command]
async fn capture_viewport_png(app: AppHandle) -> Result<String, String> {
    use base64::Engine;
    use std::sync::mpsc;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No main window".to_string())?;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

    // with_webview dispatches the closure to the main thread asynchronously
    // and returns immediately.  We block below on rx.recv_timeout() until the
    // takeSnapshot completion handler fires and sends its result.
    window
        .with_webview(move |webview| {
            use block2::RcBlock;
            use objc2::runtime::AnyObject;
            use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
            use objc2_foundation::{NSDictionary, NSError, NSString};
            use objc2_web_kit::WKWebView;

            // Build the completion handler block.
            // WKWebView calls it on the main thread once the snapshot is ready.
            let completion = RcBlock::new(
                move |ns_image: *mut NSImage, _error: *mut NSError| {
                    let result: Result<Vec<u8>, String> = (|| unsafe {
                        // nil image means the snapshot failed
                        let image = ns_image
                            .as_ref()
                            .ok_or_else(|| "takeSnapshot: NSImage is nil".to_string())?;

                        // NSImage → TIFF bytes (lossless intermediate)
                        let tiff = image
                            .TIFFRepresentation()
                            .ok_or_else(|| "TIFFRepresentation returned nil".to_string())?;

                        // TIFF bytes → NSBitmapImageRep (understands pixel data)
                        let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)
                            .ok_or_else(|| "imageRepWithData returned nil".to_string())?;

                        // NSBitmapImageRep → PNG NSData
                        let props = NSDictionary::<NSString, AnyObject>::new();
                        let png_data = bitmap
                            .representationUsingType_properties(
                                NSBitmapImageFileType::PNG,
                                &props,
                            )
                            .ok_or_else(|| "PNG representation returned nil".to_string())?;

                        Ok(png_data.as_bytes_unchecked().to_vec())
                    })();
                    let _ = tx.send(result);
                },
            );

            // Cast the opaque webview handle to WKWebView and fire the snapshot.
            // SAFETY: on macOS the inner pointer is always a WKWebView instance.
            unsafe {
                let wk: &WKWebView = &*webview.inner().cast::<WKWebView>();
                wk.takeSnapshotWithConfiguration_completionHandler(None, &*completion);
            }
        })
        .map_err(|e| format!("with_webview dispatch failed: {e}"))?;

    // Offload the blocking recv to a dedicated thread so we don't stall the
    // tokio worker.  with_webview already dispatched the snapshot work to the
    // main thread; we just need to wait for its completion handler to reply.
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(15))
            .map_err(|e| format!("capture_viewport_png timed out: {e}"))
            .and_then(|r| r) // flatten Result<Result<...>>
            .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes))
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn capture_viewport_png(_app: AppHandle) -> Result<String, String> {
    Err("capture_viewport_png is only supported on macOS".to_string())
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

// ── Tauri command: list system font families ──────────────────────────────────
//
// WKWebView does not support the browser's Local Font Access API
// (window.queryLocalFonts), so the font-picker dialog falls back to this
// native command on macOS.  NSFontManager.availableFontFamilies() returns every
// installed font family in one call; the result is sorted and deduplicated
// before being returned to the frontend.

#[cfg(target_os = "macos")]
#[tauri::command]
async fn list_fonts(app: AppHandle) -> Result<Vec<String>, String> {
    use std::sync::mpsc;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No main window".to_string())?;

    let (tx, rx) = mpsc::channel::<Vec<String>>();

    // NSFontManager must be called from the main thread.
    // with_webview() dispatches to the main thread — the same guarantee used
    // by capture_viewport_png.  We ignore the WKWebView parameter and just
    // use the dispatch as a way to safely obtain MainThreadMarker.
    window
        .with_webview(move |_webview| {
            use objc2::MainThreadMarker;
            use objc2_app_kit::NSFontManager;

            let families = if let Some(mtm) = MainThreadMarker::new() {
                let fm = NSFontManager::sharedFontManager(mtm);
                let arr = fm.availableFontFamilies();
                let mut v: Vec<String> = (0..arr.count())
                    .map(|i| arr.objectAtIndex(i).to_string())
                    .collect();
                v.sort_unstable();
                v.dedup();
                v
            } else {
                Vec::new()
            };
            let _ = tx.send(families);
        })
        .map_err(|e| format!("with_webview dispatch failed: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .unwrap_or_default()
    })
    .await
    .map_err(|e| format!("list_fonts join error: {e}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn list_fonts(_app: AppHandle) -> Result<Vec<String>, String> {
    Ok(Vec::new())
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

            // Find a port and spawn the Next.js sidecar.
            // Prefer 3737 so the URL is always http://localhost:3737 — predictable
            // for browser access and Reveal.js iframe embedding.
            let port = find_preferred_port(3737);
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
        .invoke_handler(tauri::generate_handler![pick_folder, save_file, print_page, capture_viewport_png, list_fonts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
