//! The desktop shell: a native window around the same web app that runs in browsers.
//!
//! Everything the app does happens in the webview. The native side adds only what a
//! webview cannot do on its own: open links in the system browser (the opener plugin)
//! and save files through a native dialog (`save_file` below).

use std::fs;

use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

/// Ask where to save, then write the request body there.
///
/// The bytes arrive as a raw IPC body rather than JSON, so saving a large PDF does not
/// serialise it into an array of numbers. The suggested name comes in the
/// `x-file-name` header, percent-encoded because headers must be ASCII.
/// Returns false when the user cancels.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_file expects raw bytes".into());
    };

    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(|value| percent_encoding::percent_decode_str(value).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| "download".into());

    // Async commands run off the main thread, so a blocking dialog is safe here.
    let Some(target) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|error| error.to_string())?;
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("error while running open-ed-web");
}
