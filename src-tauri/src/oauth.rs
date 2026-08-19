use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

#[derive(Serialize)]
pub struct OAuthCallbackResult {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

fn decode_percent(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

// One-shot local HTTP listener for the OAuth2 Authorization Code + PKCE
// flow's redirect_uri (http://127.0.0.1:<port>/callback). Bound and awaiting
// BEFORE the system browser is opened (see lib/oauth2.ts), so there's no
// race between the provider redirecting back and this being ready to
// receive it. Hand-parses the raw HTTP request line instead of pulling in a
// server framework, since all it ever needs to read is one GET request with
// a query string.
#[tauri::command]
pub async fn oauth2_await_callback(port: u16, timeout_secs: u64) -> Result<OAuthCallbackResult, String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("Couldn't listen on 127.0.0.1:{port}: {e}"))?;

    let accept = tokio::task::spawn_blocking(move || -> Result<OAuthCallbackResult, String> {
        let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let first_line = request.lines().next().unwrap_or("");
        let path = first_line.split_whitespace().nth(1).unwrap_or("");
        let query = path.splitn(2, '?').nth(1).unwrap_or("");

        let mut code = None;
        let mut state = None;
        let mut error = None;
        for pair in query.split('&').filter(|p| !p.is_empty()) {
            let mut it = pair.splitn(2, '=');
            let k = it.next().unwrap_or("");
            let v = decode_percent(it.next().unwrap_or(""));
            match k {
                "code" => code = Some(v),
                "state" => state = Some(v),
                "error" => error = Some(v),
                _ => {}
            }
        }

        let body = if error.is_some() {
            "<html><body style=\"font-family:sans-serif;text-align:center;margin-top:20vh\"><h2>Authorization failed</h2><p>You can close this tab and return to Relay.</p></body></html>"
        } else {
            "<html><body style=\"font-family:sans-serif;text-align:center;margin-top:20vh\"><h2>Authorization complete</h2><p>You can close this tab and return to Relay.</p></body></html>"
        };
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());

        Ok(OAuthCallbackResult { code, state, error })
    });

    match tokio::time::timeout(Duration::from_secs(timeout_secs), accept).await {
        Ok(join_result) => join_result.map_err(|e| e.to_string())?,
        Err(_) => Err("Timed out waiting for the browser to redirect back".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::decode_percent;

    #[test]
    fn passes_through_base64url_safe_chars_untouched() {
        assert_eq!(decode_percent("abcXYZ019-_"), "abcXYZ019-_");
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(decode_percent("hello%20world"), "hello world");
        assert_eq!(decode_percent("a%2Fb%3Dc"), "a/b=c");
    }

    #[test]
    fn plus_decodes_to_space() {
        assert_eq!(decode_percent("a+b"), "a b");
    }

    #[test]
    fn tolerates_a_trailing_stray_percent() {
        assert_eq!(decode_percent("abc%"), "abc%");
        assert_eq!(decode_percent("abc%2"), "abc%2");
    }

    #[test]
    fn tolerates_invalid_hex_after_percent() {
        assert_eq!(decode_percent("100%_off"), "100%_off");
    }
}
