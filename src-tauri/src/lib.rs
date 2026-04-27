mod backup;
mod badge;
mod badge_data;
mod commands;
mod db;
mod error;
mod imap;
mod parser;
mod secrets;
mod smtp;

pub use error::{Error, Result};

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_autostart::MacosLauncher;

use crate::imap::idle::IdleManager;

/// Holds the absolute SQLite connection string, computed once at startup
/// against `<exe_dir>/cursus-files/flow.db`. The frontend reads it back via
/// the `get_database_url` command so `Database.load(url)` matches the URL we
/// registered migrations against.
pub struct DbUrl(pub String);

/// Absolute portable logs directory, `<exe_dir>/cursus-files/logs/`. The
/// frontend reads it via `get_logs_dir` so the "Open log folder" button
/// always opens the same path the Rust target writes to.
pub struct LogsDir(pub PathBuf);

fn resolve_data_dir() -> PathBuf {
    let exe = std::env::current_exe().expect("current_exe");
    let exe_dir = exe.parent().expect("exe parent").to_path_buf();
    let data_dir = exe_dir.join("cursus-files");
    std::fs::create_dir_all(&data_dir).expect("create cursus-files");

    // One-shot migration for users upgrading from a "flow.db"-era build.
    // Rename the SQLite main file plus its WAL/SHM siblings, but only if
    // the new name doesn't already exist (don't clobber a fresh DB).
    let new_db = data_dir.join("cursus.db");
    let old_db = data_dir.join("flow.db");
    if old_db.exists() && !new_db.exists() {
        let _ = std::fs::rename(&old_db, &new_db);
        for (old_name, new_name) in [
            ("flow.db-wal", "cursus.db-wal"),
            ("flow.db-shm", "cursus.db-shm"),
        ] {
            let oldp = data_dir.join(old_name);
            let newp = data_dir.join(new_name);
            if oldp.exists() && !newp.exists() {
                let _ = std::fs::rename(&oldp, &newp);
            }
        }
    }

    data_dir
}

#[tauri::command]
fn get_database_url(state: tauri::State<'_, DbUrl>) -> String {
    state.0.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = resolve_data_dir();
    let db_path = data_dir.join("cursus.db");
    // SQLx's sqlite URL parser accepts forward slashes on Windows; normalise
    // backslashes so the connection string is valid on every platform.
    let db_url = format!(
        "sqlite:{}",
        db_path.to_string_lossy().replace('\\', "/")
    );

    let logs_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        // async-imap and rustls log raw protocol traces at DEBUG/TRACE that
        // include LOGIN credentials in plaintext. Cap them at WARN so the
        // password can never reach a log file or stdout, regardless of the
        // global log level chosen at build time.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("async_imap", log::LevelFilter::Warn)
                .level_for("imap_proto", log::LevelFilter::Warn)
                .level_for("async_native_tls", log::LevelFilter::Warn)
                .level_for("rustls", log::LevelFilter::Warn)
                .level_for("sqlx", log::LevelFilter::Warn)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: logs_dir.clone(),
                        file_name: Some("Cursus".into()),
                    }),
                ])
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(&db_url, db::migrations::all())
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Arc::new(IdleManager::new()))
        .manage(DbUrl(db_url.clone()))
        .manage(LogsDir(logs_dir.clone()))
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show Cursus", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().ok_or_else(|| {
                    tauri::Error::InvalidWindowHandle
                })?)
                .tooltip("Cursus")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => reveal_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::imap_test_connection,
            commands::imap_list_folders,
            commands::imap_folder_status,
            commands::imap_fetch_messages,
            commands::imap_fetch_unread,
            commands::imap_fetch_message_body,
            commands::imap_save_attachment,
            commands::imap_create_folder,
            commands::imap_rename_folder,
            commands::imap_delete_folder,
            commands::imap_set_flags,
            commands::imap_move_uid,
            commands::smtp_test_connection,
            commands::smtp_send,
            commands::resend_send,
            commands::resend_send_template,
            commands::resend_list_templates,
            commands::unsubscribe_one_click,
            commands::ping,
            commands::secrets_save,
            commands::secrets_load,
            commands::secrets_delete,
            commands::window_set_unread_badge,
            commands::app_quit,
            commands::imap_idle_start,
            commands::imap_idle_stop,
            commands::backup_seal,
            commands::backup_unseal,
            commands::backup_write_file,
            commands::backup_read_file,
            commands::log_frontend,
            commands::get_logs_dir,
            get_database_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cursus");
}

fn reveal_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}
