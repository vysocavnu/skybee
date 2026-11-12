// Skybee desktop shell: one window with the web app inside.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// `%TEMP%\skybee.log`: what the last launch got through, and why it died if it did.
fn log(line: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("skybee.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

/// A release build has no console: without this a crash is a window that just disappears.
fn report_crashes() {
    let _ = std::fs::remove_file(std::env::temp_dir().join("skybee.log"));
    std::panic::set_hook(Box::new(|info| {
        let text = format!("Skybee {} впав:\n{info}", env!("CARGO_PKG_VERSION"));
        log(&text);
        #[cfg(windows)]
        {
            #[link(name = "user32")]
            extern "system" {
                fn MessageBoxW(hwnd: *mut std::ffi::c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
            }
            let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
            let (text, caption) = (wide(&text), wide("Skybee"));
            unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10) };
        }
    }));
}

fn main() {
    report_crashes();
    log("запуск");
    tauri::Builder::default()
        // a second launch only brings the running window to the front
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init()) // also provides window.Notification for js/notify.js
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Skybee")
                .inner_size(1200.0, 820.0)
                .min_inner_size(360.0, 520.0)
                .center()
                // target=_blank links and window.open go to the system browser
                .on_new_window(move |url, _features| {
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            log("вікно створено");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не вдалося запустити Skybee");
    log("вихід");
}
