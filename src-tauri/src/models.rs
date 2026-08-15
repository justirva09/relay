use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct HttpRequestPayload {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Serialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub status_text: String,
    pub ok: bool,
    pub time_ms: u128,
    pub size_bytes: usize,
    pub headers: Vec<(String, String)>,
    pub body: String,
}
