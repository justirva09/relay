// Header-name autocomplete list for KeyValueEditor when it's editing actual
// HTTP headers (not query params, not gRPC metadata — those pass no
// suggestions at all and keep plain free-text input). X-Mock-Scenario is
// Relay's own header (see mock_server.rs) — listed first since it won't be
// muscle memory the way Authorization/Content-Type already are.
export const COMMON_HTTP_HEADERS: string[] = [
  "X-Mock-Scenario",
  "Authorization",
  "Content-Type",
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Cache-Control",
  "Cookie",
  "User-Agent",
  "X-Requested-With",
  "X-API-Key",
  "X-Forwarded-For",
  "X-CSRF-Token",
  "Origin",
  "Referer",
  "If-None-Match",
  "If-Modified-Since",
  "If-Match",
  "ETag",
  "Content-Length",
  "Content-Disposition",
  "Content-Encoding",
  "Set-Cookie",
  "Location",
  "Retry-After",
  "WWW-Authenticate",
  "Vary",
];
