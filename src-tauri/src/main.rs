// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod grpc;
mod models;
mod storage;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::http_request,
            storage::load_workspace,
            storage::save_workspace,
            storage::read_file_at_path,
            storage::write_file_at_path,
            storage::list_proto_files_in_dir,
            grpc::grpc_list_services,
            grpc::grpc_list_services_from_proto,
            grpc::list_proto_service_files,
            grpc::grpc_invoke_unary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
