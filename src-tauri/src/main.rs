// Skybee desktop shell: one window with the web app inside.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn main() {
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Skybee");
}
