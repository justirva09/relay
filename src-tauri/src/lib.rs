// Exposes the domain modules as a library so relay-cli can reuse the same
// request-sending and .relay parsing code without the Tauri GUI runtime.
pub mod commands;
pub mod cookie_jar;
pub mod git;
pub mod grpc;
pub mod mock_server;
pub mod models;
pub mod oauth;
pub mod perf;
pub mod response_cache;
pub mod storage;
pub mod version_check;
