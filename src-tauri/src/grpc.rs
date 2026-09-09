use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, FieldDescriptor, Kind, MessageDescriptor};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::collections::HashSet;
use std::str::FromStr;
use std::time::{Duration, Instant};
use tonic::codec::{Codec, CompressionEncoding, DecodeBuf, Decoder, EncodeBuf, Encoder};
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
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub wait_for_ready: bool,
    #[serde(default)]
    pub compression: Option<String>,
    #[serde(default)]
    pub max_response_size_bytes: Option<usize>,
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

/// tonic/hyper only understand http(s):// schemes. Rewrite the grpc(s)://
/// convention from the UI, and default a bare host with no scheme to TLS
/// since that's how most hosted gRPC endpoints are reachable.
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

async fn connect_for_request(url: &str, wait_for_ready: bool) -> Result<Channel, String> {
    if !wait_for_ready {
        return connect(url).await;
    }
    loop {
        match connect(url).await {
            Ok(channel) => return Ok(channel),
            Err(_) => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    }
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

/// Resolves a service's file plus all transitive proto dependencies into one
/// DescriptorPool. `file_containing_symbol` isn't guaranteed to include
/// imports, so missing ones get fetched by filename until nothing's left.
async fn build_pool_for_service(url: &str, service: &str) -> Result<DescriptorPool, String> {
    build_pool_for_service_with_wait(url, service, false).await
}

async fn build_pool_for_service_with_wait(
    url: &str,
    service: &str,
    wait_for_ready: bool,
) -> Result<DescriptorPool, String> {
    let channel = connect_for_request(url, wait_for_ready).await?;

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

/// Resolves the buf/validate/validate.proto import used by protovalidate
/// schemas, bundled the same way GoogleFileResolver bundles well-known types.
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

/// Resolves imports against locally-attached .proto files, keyed by relative
/// path like `protoc -I`. Falls back to a basename match for files attached
/// without directory structure.
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

/// Compiles a locally-attached .proto file and its transitive imports into a
/// DescriptorPool, no network reflection call needed.
fn build_pool_from_proto_files(files: &[ProtoFileInput], entry_file: &str) -> Result<DescriptorPool, String> {
    let mut file_map = HashMap::new();
    for f in files {
        file_map.insert(f.name.clone(), f.content.clone());
    }

    // Bundled well-known types are checked first. Proto repos sometimes vendor
    // their own copy of google/protobuf/*.proto, and a stale one can shadow
    // our bundled copy and cause bogus import cycles.
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

/// Syntax-only check for which files declare at least one service, so
/// message-only files don't show up in the "active spec" picker.
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

// Field info for the frontend's message-editor autocomplete, one node per
// field, recursed with a cycle guard for self-referential messages.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoFieldSchema {
    pub name: String,
    pub kind: String,
    pub type_name: String,
    pub repeated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oneof: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<ProtoFieldSchema>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enum_values: Vec<String>,
}

#[derive(Serialize)]
pub struct GrpcMethodSchema {
    pub template: String,
    pub fields: Vec<ProtoFieldSchema>,
}

fn field_schema(field: &FieldDescriptor, ancestors: &HashSet<String>) -> ProtoFieldSchema {
    let name = field.json_name().to_string();
    let repeated = field.is_list();
    let oneof = field
        .containing_oneof()
        .filter(|oneof| !oneof.is_synthetic())
        .map(|oneof| oneof.name().to_string());
    let type_name = if field.is_map() {
        "map".to_string()
    } else {
        match field.kind() {
            Kind::Double => "double".to_string(),
            Kind::Float => "float".to_string(),
            Kind::Int32 => "int32".to_string(),
            Kind::Int64 => "int64".to_string(),
            Kind::Uint32 => "uint32".to_string(),
            Kind::Uint64 => "uint64".to_string(),
            Kind::Sint32 => "sint32".to_string(),
            Kind::Sint64 => "sint64".to_string(),
            Kind::Fixed32 => "fixed32".to_string(),
            Kind::Fixed64 => "fixed64".to_string(),
            Kind::Sfixed32 => "sfixed32".to_string(),
            Kind::Sfixed64 => "sfixed64".to_string(),
            Kind::Bool => "bool".to_string(),
            Kind::String => "string".to_string(),
            Kind::Bytes => "bytes".to_string(),
            Kind::Message(message) => message.full_name().to_string(),
            Kind::Enum(enumeration) => enumeration.full_name().to_string(),
        }
    };

    if field.is_map() {
        return ProtoFieldSchema {
            name,
            kind: "map".to_string(),
            type_name,
            repeated: false,
            oneof,
            fields: vec![],
            enum_values: vec![],
        };
    }

    match field.kind() {
        Kind::Message(m) => {
            let full_name = m.full_name().to_string();
            if ancestors.contains(&full_name) {
                ProtoFieldSchema {
                    name,
                    kind: "message".to_string(),
                    type_name,
                    repeated,
                    oneof,
                    fields: vec![],
                    enum_values: vec![],
                }
            } else {
                let mut next = ancestors.clone();
                next.insert(full_name);
                let fields = m.fields().map(|f| field_schema(&f, &next)).collect();
                ProtoFieldSchema {
                    name,
                    kind: "message".to_string(),
                    type_name,
                    repeated,
                    oneof,
                    fields,
                    enum_values: vec![],
                }
            }
        }
        Kind::Enum(e) => ProtoFieldSchema {
            name,
            kind: "enum".to_string(),
            type_name,
            repeated,
            oneof,
            fields: vec![],
            enum_values: e.values().map(|v| v.name().to_string()).collect(),
        },
        Kind::Bool => ProtoFieldSchema {
            name,
            kind: "bool".to_string(),
            type_name,
            repeated,
            oneof,
            fields: vec![],
            enum_values: vec![],
        },
        Kind::String | Kind::Bytes => ProtoFieldSchema {
            name,
            kind: "string".to_string(),
            type_name,
            repeated,
            oneof,
            fields: vec![],
            enum_values: vec![],
        },
        _ => ProtoFieldSchema {
            name,
            kind: "number".to_string(),
            type_name,
            repeated,
            oneof,
            fields: vec![],
            enum_values: vec![],
        },
    }
}

// proto3 JSON mapping wants 64-bit ints as decimal strings, everything else as a number.
fn scalar_placeholder(kind: &Kind) -> serde_json::Value {
    match kind {
        Kind::Int64 | Kind::Uint64 | Kind::Sint64 | Kind::Fixed64 | Kind::Sfixed64 => json!("0"),
        Kind::Bool => json!(false),
        Kind::String | Kind::Bytes => json!(""),
        _ => json!(0),
    }
}

// Well-known protobuf messages have special ProtoJSON representations instead
// of their underlying message fields. Keep this aligned with prost-reflect's
// serde support so generated templates can be sent back without manual fixes.
fn well_known_placeholder(message: &MessageDescriptor) -> Option<serde_json::Value> {
    match message.full_name() {
        "google.protobuf.Timestamp" => Some(json!("1970-01-01T00:00:00Z")),
        "google.protobuf.Duration" => Some(json!("0s")),
        "google.protobuf.FieldMask" => Some(json!("")),
        "google.protobuf.FloatValue" | "google.protobuf.DoubleValue" | "google.protobuf.Int32Value" | "google.protobuf.UInt32Value" => Some(json!(0)),
        "google.protobuf.Int64Value" | "google.protobuf.UInt64Value" => Some(json!("0")),
        "google.protobuf.BoolValue" => Some(json!(false)),
        "google.protobuf.StringValue" | "google.protobuf.BytesValue" => Some(json!("")),
        "google.protobuf.Struct" | "google.protobuf.Empty" => Some(json!({})),
        "google.protobuf.ListValue" => Some(json!([])),
        "google.protobuf.Value" => Some(serde_json::Value::Null),
        _ => None,
    }
}

fn field_placeholder(field: &FieldDescriptor, ancestors: &HashSet<String>) -> serde_json::Value {
    if field.is_map() {
        return json!({});
    }

    let single = |kind: &Kind, ancestors: &HashSet<String>| -> serde_json::Value {
        match kind {
            Kind::Message(m) => well_known_placeholder(m).unwrap_or_else(|| message_template(m, ancestors)),
            Kind::Enum(e) => json!(e.values().next().map(|v| v.name().to_string()).unwrap_or_default()),
            other => scalar_placeholder(other),
        }
    };

    if field.is_list() {
        json!([single(&field.kind(), ancestors)])
    } else {
        single(&field.kind(), ancestors)
    }
}

fn message_template(desc: &MessageDescriptor, ancestors: &HashSet<String>) -> serde_json::Value {
    if let Some(value) = well_known_placeholder(desc) {
        return value;
    }
    let full_name = desc.full_name().to_string();
    if ancestors.contains(&full_name) {
        return json!({});
    }
    let mut next = ancestors.clone();
    next.insert(full_name);

    let mut obj = serde_json::Map::new();
    for field in desc.fields() {
        // A oneof may be completely unset, but setting multiple alternatives is
        // invalid. Leave real oneofs out of the default template so the generated
        // JSON is always valid and let autocomplete offer the alternatives.
        if field.containing_oneof().is_some_and(|oneof| !oneof.is_synthetic()) {
            continue;
        }
        // Any requires a concrete @type that cannot be inferred from its field
        // descriptor. Leaving it unset is valid; autocomplete still exposes it.
        if matches!(field.kind(), Kind::Message(message) if message.full_name() == "google.protobuf.Any") {
            continue;
        }
        obj.insert(field.json_name().to_string(), field_placeholder(&field, &next));
    }
    serde_json::Value::Object(obj)
}

#[tauri::command]
pub async fn grpc_method_schema(
    url: String,
    service: String,
    method: String,
    proto_files: Option<Vec<ProtoFileInput>>,
    entry_file: Option<String>,
) -> Result<GrpcMethodSchema, String> {
    let pool = match (&proto_files, &entry_file) {
        (Some(files), Some(entry_file)) => build_pool_from_proto_files(files, entry_file)?,
        _ => build_pool_for_service(&url, &service).await?,
    };
    let service_desc = pool.get_service_by_name(&service).ok_or_else(|| format!("service {} not found", service))?;
    let method_desc = service_desc
        .methods()
        .find(|m| m.name() == method)
        .ok_or_else(|| format!("method {} not found on {}", method, service))?;
    let input_desc = method_desc.input();

    let ancestors = HashSet::new();
    let template_value = message_template(&input_desc, &ancestors);
    let template = serde_json::to_string_pretty(&template_value).map_err(|e| e.to_string())?;
    let fields = input_desc.fields().map(|f| field_schema(&f, &ancestors)).collect();

    Ok(GrpcMethodSchema { template, fields })
}

async fn invoke_unary_inner(payload: GrpcInvokeRequest, deadline: Instant) -> Result<GrpcInvokeResponse, String> {
    let pool = match (&payload.proto_files, &payload.entry_file) {
        (Some(files), Some(entry_file)) => build_pool_from_proto_files(files, entry_file)?,
        _ => build_pool_for_service_with_wait(&payload.url, &payload.service, payload.wait_for_ready).await?,
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

    let channel = connect_for_request(&payload.url, payload.wait_for_ready).await?;
    let max_response_size = payload.max_response_size_bytes.unwrap_or(4 * 1024 * 1024);
    if max_response_size == 0 {
        return Err("max response size must be greater than zero".to_string());
    }
    let mut grpc_client = tonic::client::Grpc::new(channel).max_decoding_message_size(max_response_size);
    match payload.compression.as_deref().unwrap_or("none") {
        "none" => {}
        "gzip" => {
            grpc_client = grpc_client
                .send_compressed(CompressionEncoding::Gzip)
                .accept_compressed(CompressionEncoding::Gzip);
        }
        value => return Err(format!("unsupported gRPC compression: {value}")),
    }
    grpc_client
        .ready()
        .await
        .map_err(|e| format!("connection not ready: {e}"))?;

    let path_str = format!("/{}/{}", payload.service, payload.method);
    let path = http::uri::PathAndQuery::from_str(&path_str).map_err(|e| format!("invalid method path: {e}"))?;

    let mut request = Request::new(message);
    request.set_timeout(deadline.saturating_duration_since(Instant::now()));
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

#[tauri::command]
pub async fn grpc_invoke_unary(payload: GrpcInvokeRequest) -> Result<GrpcInvokeResponse, String> {
    let timeout = Duration::from_millis(payload.timeout_ms.filter(|value| *value > 0).unwrap_or(30_000));
    let deadline = Instant::now() + timeout;
    tokio::time::timeout(timeout, invoke_unary_inner(payload, deadline))
        .await
        .map_err(|_| format!("gRPC request deadline exceeded after {} ms", timeout.as_millis()))?
}

#[cfg(test)]
mod schema_tests {
    use super::*;

    const TEST_PROTO: &str = r#"
        syntax = "proto3";
        package test;

        import "google/protobuf/any.proto";
        import "google/protobuf/duration.proto";
        import "google/protobuf/empty.proto";
        import "google/protobuf/field_mask.proto";
        import "google/protobuf/struct.proto";
        import "google/protobuf/timestamp.proto";
        import "google/protobuf/wrappers.proto";

        enum Status {
            STATUS_UNKNOWN = 0;
            STATUS_ACTIVE = 1;
        }

        message Node {
            string label = 1;
            repeated Node children = 2;
        }

        message CreatePetRequest {
            string name = 1;
            int32 age = 2;
            int64 owner_id = 3;
            bool vaccinated = 4;
            Status status = 5;
            repeated string tags = 6;
            Node tree = 7;
            map<string, string> metadata = 8;
            oneof contact {
                string email = 9;
                string phone = 10;
            }
            optional string nickname = 11;
            google.protobuf.Timestamp created_at = 12;
            google.protobuf.Duration timeout = 13;
            google.protobuf.FieldMask field_mask = 14;
            google.protobuf.Int64Value wrapped_count = 15;
            google.protobuf.Struct arbitrary_object = 16;
            google.protobuf.ListValue arbitrary_list = 17;
            google.protobuf.Value arbitrary_value = 18;
            google.protobuf.Empty empty_value = 19;
            google.protobuf.Any any_value = 20;
        }

        service PetService {
            rpc CreatePet(CreatePetRequest) returns (CreatePetRequest);
        }
    "#;

    fn test_pool() -> DescriptorPool {
        let files = vec![ProtoFileInput { name: "test.proto".to_string(), content: TEST_PROTO.to_string() }];
        build_pool_from_proto_files(&files, "test.proto").expect("proto should compile")
    }

    #[test]
    fn generates_template_and_schema_for_all_field_kinds() {
        let pool = test_pool();
        let service = pool.get_service_by_name("test.PetService").unwrap();
        let method = service.methods().find(|m| m.name() == "CreatePet").unwrap();
        let input = method.input();

        let ancestors = HashSet::new();
        let template = message_template(&input, &ancestors);
        let obj = template.as_object().unwrap();

        assert_eq!(obj["name"], json!(""));
        assert_eq!(obj["age"], json!(0));
        assert_eq!(obj["ownerId"], json!("0"), "int64 must be a JSON string per proto3 JSON mapping");
        assert_eq!(obj["vaccinated"], json!(false));
        assert_eq!(obj["status"], json!("STATUS_UNKNOWN"), "enum defaults to its first value's name");
        assert_eq!(obj["tags"], json!([""]));
        assert_eq!(obj["metadata"], json!({}), "map fields placeholder as an empty object");
        assert!(obj["tree"].is_object(), "nested message field recurses into an object");
        assert!(!obj.contains_key("email"), "oneof alternatives must be omitted from the default template");
        assert!(!obj.contains_key("phone"), "oneof alternatives must be omitted from the default template");
        assert_eq!(obj["nickname"], json!(""), "proto3 optional fields are not user-facing oneofs");
        assert_eq!(obj["createdAt"], json!("1970-01-01T00:00:00Z"));
        assert_eq!(obj["timeout"], json!("0s"));
        assert_eq!(obj["fieldMask"], json!(""));
        assert_eq!(obj["wrappedCount"], json!("0"));
        assert_eq!(obj["arbitraryObject"], json!({}));
        assert_eq!(obj["arbitraryList"], json!([]));
        assert_eq!(obj["arbitraryValue"], serde_json::Value::Null);
        assert_eq!(obj["emptyValue"], json!({}));
        assert!(!obj.contains_key("anyValue"), "Any needs a concrete @type and must be omitted by default");

        let template_json = serde_json::to_string(&template).unwrap();
        let mut deserializer = serde_json::Deserializer::from_str(&template_json);
        DynamicMessage::deserialize(input.clone(), &mut deserializer).expect("the generated template must deserialize as its input message type");

        let fields = input.fields().map(|f| field_schema(&f, &ancestors)).collect::<Vec<_>>();
        let status_field = fields.iter().find(|f| f.name == "status").unwrap();
        assert_eq!(status_field.kind, "enum");
        assert_eq!(status_field.enum_values, vec!["STATUS_UNKNOWN", "STATUS_ACTIVE"]);

        let tree_field = fields.iter().find(|f| f.name == "tree").unwrap();
        assert_eq!(tree_field.kind, "message");
        assert!(tree_field.fields.iter().any(|f| f.name == "label"));

        let email_field = fields.iter().find(|f| f.name == "email").unwrap();
        assert_eq!(email_field.type_name, "string");
        assert_eq!(email_field.oneof.as_deref(), Some("contact"));
        let phone_field = fields.iter().find(|f| f.name == "phone").unwrap();
        assert_eq!(phone_field.oneof.as_deref(), Some("contact"));
        let nickname_field = fields.iter().find(|f| f.name == "nickname").unwrap();
        assert_eq!(nickname_field.oneof, None, "synthetic optional oneofs must stay hidden");

        let serialized = serde_json::to_value(email_field).unwrap();
        assert_eq!(serialized["typeName"], "string");
        assert_eq!(serialized["oneof"], "contact");
    }

    #[test]
    fn self_referential_message_does_not_infinite_loop() {
        let pool = test_pool();
        let node = pool.get_message_by_name("test.Node").unwrap();
        let ancestors = HashSet::new();
        // Node.children is `repeated Node`, must terminate instead of recursing forever.
        let template = message_template(&node, &ancestors);
        assert!(template.is_object());
    }
}
