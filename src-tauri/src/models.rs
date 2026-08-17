use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct FormDataFieldPayload {
    pub key: String,
    /// Text value, or an absolute file path when `is_file` is true.
    pub value: String,
    pub is_file: bool,
}

#[derive(Deserialize)]
pub struct HttpRequestPayload {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub form_data: Option<Vec<FormDataFieldPayload>>,
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
