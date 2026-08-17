// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod git;
mod grpc;
mod mock_server;
mod models;
mod response_cache;
mod storage;
mod version_check;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(mock_server::MockServerState::default())
        .invoke_handler(tauri::generate_handler![
            commands::http_request,
            storage::load_workspace,
            storage::save_workspace,
            storage::load_workspace_dir,
            storage::save_workspace_dir,
            storage::get_last_workspace_dir,
            storage::set_last_workspace_dir,
            storage::dir_has_other_files,
            storage::read_file_at_path,
            storage::write_file_at_path,
            storage::list_proto_files_in_dir,
            git::git_status,
            git::git_init,
            git::git_commit,
            response_cache::load_response_cache,
            response_cache::save_response_cache,
            version_check::check_version_status,
            grpc::grpc_list_services,
            grpc::grpc_list_services_from_proto,
            grpc::list_proto_service_files,
            grpc::grpc_method_schema,
            grpc::grpc_invoke_unary,
            mock_server::start_mock_server,
            mock_server::stop_mock_server,
            mock_server::mock_server_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
