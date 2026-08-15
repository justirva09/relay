use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::str::FromStr;
use std::time::{Duration, Instant};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::transport::{Channel, ClientTlsConfig, Endpoint};
use tonic::{Request, Status};

use tonic_reflection::pb::v1alpha::server_reflection_client::ServerReflectionClient;
use tonic_reflection::pb::v1alpha::server_reflection_request::MessageRequest;
use tonic_reflection::pb::v1alpha::server_reflection_response::MessageResponse;
use tonic_reflection::pb::v1alpha::{FileDescriptorResponse, ServerReflectionRequest};

use protox::file::{ChainFileResolver, File as ProtoFile, FileResolver, GoogleFileResolver};

#[derive(Serialize)]
pub struct GrpcMethodInfo {
    pub name: String,
    pub method_type: String,
}

#[derive(Serialize)]
pub struct GrpcServiceInfo {
    pub name: String,
    pub methods: Vec<GrpcMethodInfo>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ProtoFileInput {
    pub name: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct GrpcInvokeRequest {
    pub url: String,
    pub service: String,
    pub method: String,
    pub message_json: String,
    #[serde(default)]
    pub metadata: Vec<(String, String)>,
    #[serde(default)]
    pub proto_files: Option<Vec<ProtoFileInput>>,
    #[serde(default)]
    pub entry_file: Option<String>,
}

#[derive(Serialize)]
pub struct GrpcInvokeResponse {
    pub json: String,
    pub metadata: Vec<(String, String)>,
    pub duration_ms: u64,
}

/// tonic/hyper only understand http:// and https:// schemes. Accept the
/// grpc:// / grpcs:// convention shown in the UI (and Postman) and rewrite
/// it, and default a bare host with no scheme at all to TLS, since that's
/// how virtually every hosted gRPC endpoint (behind an ALB/gateway) is
/// actually reachable — matches Postman's "secured by default" behavior.
fn normalize_url(url: &str) -> (String, bool) {
    if let Some(rest) = url.strip_prefix("grpcs://") {
        (format!("https://{rest}"), true)
    } else if let Some(rest) = url.strip_prefix("grpc://") {
        (format!("http://{rest}"), false)
    } else if url.starts_with("https://") {
        (url.to_string(), true)
    } else if url.starts_with("http://") {
        (url.to_string(), false)
    } else {
        (format!("https://{url}"), true)
    }
}

async fn connect(url: &str) -> Result<Channel, String> {
    let (normalized, use_tls) = normalize_url(url);
    let mut endpoint = Endpoint::from_shared(normalized)
        .map_err(|e| format!("invalid url: {e}"))?
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10));
    if use_tls {
        endpoint = endpoint
            .tls_config(ClientTlsConfig::new().with_native_roots())
            .map_err(|e| format!("tls config failed: {e}"))?;
    }
    endpoint
        .connect()
        .await
        .map_err(|e| format!("connect failed: {e}"))
}

async fn reflection_request(channel: Channel, req: MessageRequest) -> Result<MessageResponse, String> {
    let mut client = ServerReflectionClient::new(channel);
    let out_req = ServerReflectionRequest {
        host: String::new(),
        message_request: Some(req),
    };
    let stream = tokio_stream::once(out_req);
    let mut resp_stream = client
        .server_reflection_info(Request::new(stream))
        .await
        .map_err(|e| format!("reflection call failed (is server reflection enabled?): {e}"))?
        .into_inner();
    let resp = resp_stream
        .message()
        .await
        .map_err(|e| format!("reflection stream error: {e}"))?
        .ok_or_else(|| "empty reflection response".to_string())?;
    resp.message_response
        .ok_or_else(|| "reflection response had no payload".to_string())
}

fn decode_file_descriptor_response(resp: MessageResponse) -> Result<FileDescriptorResponse, String> {
    match resp {
        MessageResponse::FileDescriptorResponse(r) => Ok(r),
        MessageResponse::ErrorResponse(e) => Err(format!("reflection error {}: {}", e.error_code, e.error_message)),
        _ => Err("unexpected reflection response variant".to_string()),
    }
}

/// Recursively resolves a service's file and all its transitive proto dependencies
/// into a single DescriptorPool, mirroring how grpcurl-style clients handle
/// gRPC server reflection (a single `file_containing_symbol` call is not
/// guaranteed to include imported files, so missing imports are fetched
/// individually by filename until the whole dependency graph is present).
async fn build_pool_for_service(url: &str, service: &str) -> Result<DescriptorPool, String> {
    let channel = connect(url).await?;

    let resp = reflection_request(
        channel.clone(),
        MessageRequest::FileContainingSymbol(service.to_string()),
    )
    .await?;
    let initial = decode_file_descriptor_response(resp)?;

    let mut files_by_name: std::collections::HashMap<String, prost_types::FileDescriptorProto> = std::collections::HashMap::new();
    let mut queue: Vec<Vec<u8>> = initial.file_descriptor_proto;
    let mut requested_names: HashSet<String> = HashSet::new();

    while let Some(bytes) = queue.pop() {
        let fdp = prost_types::FileDescriptorProto::decode(bytes.as_slice())
            .map_err(|e| format!("failed to decode file descriptor: {e}"))?;
        let name = fdp.name.clone().unwrap_or_default();
        if files_by_name.contains_key(&name) {
            continue;
        }
        let deps = fdp.dependency.clone();
        files_by_name.insert(name, fdp);

        for dep in deps {
            if files_by_name.contains_key(&dep) || requested_names.contains(&dep) {
                continue;
            }
            requested_names.insert(dep.clone());
            let dep_resp = reflection_request(channel.clone(), MessageRequest::FileByFilename(dep.clone())).await?;
            let dep_files = decode_file_descriptor_response(dep_resp)?;
            for f in dep_files.file_descriptor_proto {
                queue.push(f);
            }
        }
    }

    let file_descriptor_set = prost_types::FileDescriptorSet {
        file: files_by_name.into_values().collect(),
    };

    DescriptorPool::from_file_descriptor_set(file_descriptor_set)
        .map_err(|e| format!("failed to build descriptor pool: {e}"))
}

const BUF_VALIDATE_PROTO: &str = include_str!("wellknown/buf/validate/validate.proto");

/// Resolves the `buf/validate/validate.proto` import used by protovalidate-annotated
/// schemas (very common in Buf-managed proto repos), bundled the same way
/// `GoogleFileResolver` bundles the core `google/protobuf/*.proto` well-known types.
struct BufValidateFileResolver;

impl FileResolver for BufValidateFileResolver {
    fn open_file(&self, name: &str) -> Result<ProtoFile, protox::Error> {
        if name == "buf/validate/validate.proto" {
            ProtoFile::from_source(name, BUF_VALIDATE_PROTO)
        } else {
            Err(protox::Error::file_not_found(name))
        }
    }
}

/// Resolves imports against a fixed set of locally-attached .proto files, keyed by
/// their path relative to the imported root directory — matching `import "pkg/sub/file.proto";`
/// statements exactly, the same way `protoc -I` resolves them. Falls back to a basename
/// match for files attached without directory structure (e.g. individually-picked files).
struct MemoryFileResolver {
    files: HashMap<String, String>,
}

impl FileResolver for MemoryFileResolver {
    fn open_file(&self, name: &str) -> Result<ProtoFile, protox::Error> {
        if let Some(content) = self.files.get(name) {
            return ProtoFile::from_source(name, content);
        }
        let basename = name.rsplit('/').next().unwrap_or(name);
        for (key, content) in &self.files {
            if key.rsplit('/').next() == Some(basename) {
                return ProtoFile::from_source(name, content);
            }
        }
        Err(protox::Error::file_not_found(name))
    }
}

/// Compiles a locally-attached .proto file (and its transitive imports, resolved
/// from the same attached set, falling back to bundled google/protobuf well-known
/// types) into a DescriptorPool, without any network reflection call.
fn build_pool_from_proto_files(files: &[ProtoFileInput], entry_file: &str) -> Result<DescriptorPool, String> {
    let mut file_map = HashMap::new();
    for f in files {
        file_map.insert(f.name.clone(), f.content.clone());
    }

    // Bundled well-known types are checked before the user's own attached files:
    // proto repos commonly vendor local copies of `google/protobuf/*.proto` or
    // `buf/validate/validate.proto` at those exact paths, and a stale/mismatched
    // vendored copy can otherwise shadow our known-good bundled one and produce
    // bogus import cycles.
    let mut resolver = ChainFileResolver::new();
    resolver.add(BufValidateFileResolver);
    resolver.add(GoogleFileResolver::new());
    resolver.add(MemoryFileResolver { files: file_map });

    let mut compiler = protox::Compiler::with_file_resolver(resolver);
    compiler.include_imports(true);
    compiler
        .open_file(entry_file)
        .map_err(|e| format!("failed to parse {entry_file}: {e}"))?;

    Ok(compiler.descriptor_pool())
}

/// Syntax-only check (no import resolution) for which of the given files declare
/// at least one `service`. Used to keep message/entity-only files out of the
/// "active spec" picker — only files that are actually invokable belong there.
#[tauri::command]
pub fn list_proto_service_files(files: Vec<ProtoFileInput>) -> Vec<String> {
    files
        .into_iter()
        .filter(|f| {
            ProtoFile::from_source(&f.name, &f.content)
                .map(|file| !file.file_descriptor_proto().service.is_empty())
                .unwrap_or(false)
        })
        .map(|f| f.name)
        .collect()
}

#[tauri::command]
pub fn grpc_list_services_from_proto(
    files: Vec<ProtoFileInput>,
    entry_file: String,
) -> Result<Vec<GrpcServiceInfo>, String> {
    let pool = build_pool_from_proto_files(&files, &entry_file)?;

    let mut services = Vec::new();
    for service_desc in pool.services() {
        if service_desc.parent_file().name() != entry_file {
            continue;
        }
        let methods = service_desc
            .methods()
            .map(|m| GrpcMethodInfo {
                name: m.name().to_string(),
                method_type: method_type_str(m.is_client_streaming(), m.is_server_streaming()).to_string(),
            })
            .collect();
        services.push(GrpcServiceInfo { name: service_desc.full_name().to_string(), methods });
    }

    Ok(services)
}

fn method_type_str(client_streaming: bool, server_streaming: bool) -> &'static str {
    match (client_streaming, server_streaming) {
        (false, false) => "unary",
        (false, true) => "server-stream",
        (true, false) => "client-stream",
        (true, true) => "bidi",
    }
}

#[tauri::command]
pub async fn grpc_list_services(url: String) -> Result<Vec<GrpcServiceInfo>, String> {
    let channel = connect(&url).await?;
    let resp = reflection_request(channel, MessageRequest::ListServices(String::new())).await?;
    let list = match resp {
        MessageResponse::ListServicesResponse(l) => l,
        MessageResponse::ErrorResponse(e) => return Err(format!("reflection error {}: {}", e.error_code, e.error_message)),
        _ => return Err("unexpected reflection response variant".to_string()),
    };

    let mut services = Vec::new();
    for svc in list.service {
        if svc.name.starts_with("grpc.reflection.") {
            continue;
        }
        let pool = match build_pool_for_service(&url, &svc.name).await {
            Ok(p) => p,
            Err(_) => continue,
        };
        let Some(service_desc) = pool.get_service_by_name(&svc.name) else {
            continue;
        };
        let methods = service_desc
            .methods()
            .map(|m| GrpcMethodInfo {
                name: m.name().to_string(),
                method_type: method_type_str(m.is_client_streaming(), m.is_server_streaming()).to_string(),
            })
            .collect();
        services.push(GrpcServiceInfo { name: svc.name, methods });
    }

    Ok(services)
}

#[derive(Clone)]
struct DynamicCodec {
    output_desc: MessageDescriptor,
}

struct DynamicEncoder;

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, buf: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(buf).map_err(|e| Status::internal(format!("encode failed: {e}")))
    }
}

struct DynamicDecoder {
    desc: MessageDescriptor,
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, buf: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let msg = DynamicMessage::decode(self.desc.clone(), buf)
            .map_err(|e| Status::internal(format!("decode failed: {e}")))?;
        Ok(Some(msg))
    }
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder { desc: self.output_desc.clone() }
    }
}

#[tauri::command]
pub async fn grpc_invoke_unary(payload: GrpcInvokeRequest) -> Result<GrpcInvokeResponse, String> {
    let pool = match (&payload.proto_files, &payload.entry_file) {
        (Some(files), Some(entry_file)) => build_pool_from_proto_files(files, entry_file)?,
        _ => build_pool_for_service(&payload.url, &payload.service).await?,
    };
    let service_desc = pool
        .get_service_by_name(&payload.service)
        .ok_or_else(|| format!("service {} not found", payload.service))?;
    let method_desc = service_desc
        .methods()
        .find(|m| m.name() == payload.method)
        .ok_or_else(|| format!("method {} not found on {}", payload.method, payload.service))?;

    let input_desc = method_desc.input();
    let output_desc = method_desc.output();

    let mut deserializer = serde_json::Deserializer::from_str(&payload.message_json);
    let message = DynamicMessage::deserialize(input_desc, &mut deserializer)
        .map_err(|e| format!("invalid message JSON: {e}"))?;
    deserializer
        .end()
        .map_err(|e| format!("invalid message JSON: {e}"))?;

    let started = Instant::now();

    let channel = connect(&payload.url).await?;
    let mut grpc_client = tonic::client::Grpc::new(channel);
    grpc_client
        .ready()
        .await
        .map_err(|e| format!("connection not ready: {e}"))?;

    let path_str = format!("/{}/{}", payload.service, payload.method);
    let path = http::uri::PathAndQuery::from_str(&path_str).map_err(|e| format!("invalid method path: {e}"))?;

    let mut request = Request::new(message);
    for (k, v) in &payload.metadata {
        let key = tonic::metadata::MetadataKey::from_bytes(k.to_lowercase().as_bytes())
            .map_err(|e| format!("invalid metadata key {k}: {e}"))?;
        let value = tonic::metadata::MetadataValue::try_from(v.as_str())
            .map_err(|e| format!("invalid metadata value for {k}: {e}"))?;
        request.metadata_mut().insert(key, value);
    }

    let codec = DynamicCodec { output_desc };
    let response = grpc_client
        .unary(request, path, codec)
        .await
        .map_err(|status| format!("gRPC error ({:?}): {}", status.code(), status.message()))?;

    let duration_ms = started.elapsed().as_millis() as u64;

    let metadata = response
        .metadata()
        .iter()
        .filter_map(|kv| match kv {
            tonic::metadata::KeyAndValueRef::Ascii(k, v) => {
                Some((k.to_string(), v.to_str().unwrap_or("<invalid>").to_string()))
            }
            tonic::metadata::KeyAndValueRef::Binary(k, v) => {
                Some((k.to_string(), format!("<binary, {} bytes>", v.to_bytes().map(|b| b.len()).unwrap_or(0))))
            }
        })
        .collect();

    let dynamic_response = response.into_inner();
    let mut buf = Vec::new();
    let mut serializer = serde_json::Serializer::pretty(&mut buf);
    dynamic_response
        .serialize_with_options(&mut serializer, &prost_reflect::SerializeOptions::new())
        .map_err(|e| format!("failed to serialize response: {e}"))?;

    Ok(GrpcInvokeResponse {
        json: String::from_utf8(buf).map_err(|e| e.to_string())?,
        metadata,
        duration_ms,
    })
}
