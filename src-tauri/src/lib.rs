// Exposes the app's domain modules as a library so a second binary target
// (src/bin/relay-cli.rs) can reuse the same request-sending and .relay
// parsing code without pulling in the Tauri GUI runtime — see main.rs for
// the GUI binary that also uses these modules via Tauri commands.
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
