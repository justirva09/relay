use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, FieldDescriptor, Kind, MessageDescriptor, Value};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::Channel as IpcChannel;
use tauri::State;
use tokio::sync::watch;
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
    pub template: String,
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

#[derive(Default)]
pub struct GrpcStreamState {
    cancellations: Mutex<HashMap<String, watch::Sender<bool>>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GrpcStreamEvent {
    Metadata { metadata: Vec<(String, String)> },
    Message { json: String },
}

#[derive(Serialize)]
pub struct GrpcStreamResponse {
    pub json: String,
    pub metadata: Vec<(String, String)>,
    pub duration_ms: u64,
    pub size_bytes: usize,
    pub message_count: usize,
    pub cancelled: bool,
}

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_MAX_RESPONSE_SIZE: usize = 4 * 1024 * 1024;
const MAX_RESPONSE_SIZE: usize = 1024 * 1024 * 1024;

fn request_timeout(timeout_ms: Option<u64>) -> Duration {
    Duration::from_millis(timeout_ms.filter(|value| *value > 0).unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS))
}

fn max_response_size(value: Option<usize>) -> Result<usize, String> {
    let value = value.unwrap_or(DEFAULT_MAX_RESPONSE_SIZE);
    if value == 0 || value > MAX_RESPONSE_SIZE {
        return Err("max response size must be between 1 byte and 1024 MB".to_string());
    }
    Ok(value)
}

fn compression_encoding(value: Option<&str>) -> Result<Option<CompressionEncoding>, String> {
    match value.unwrap_or("none") {
        "none" => Ok(None),
        "gzip" => Ok(Some(CompressionEncoding::Gzip)),
        value => Err(format!("unsupported gRPC compression: {value}")),
    }
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
                template: serde_json::to_string_pretty(&message_template(&m.input(), &HashSet::new(), true))
                    .unwrap_or_else(|_| "{}".to_string()),
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
                template: serde_json::to_string_pretty(&message_template(&m.input(), &HashSet::new(), true))
                    .unwrap_or_else(|_| "{}".to_string()),
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
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oneof: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<ProtoFieldSchema>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enum_values: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_value: Option<Box<ProtoFieldSchema>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMethodSchema {
    pub template: String,
    pub fields: Vec<ProtoFieldSchema>,
    pub input_type: String,
    pub output_type: String,
    pub output_fields: Vec<ProtoFieldSchema>,
}

fn field_schema(field: &FieldDescriptor, ancestors: &HashSet<String>) -> ProtoFieldSchema {
    let name = field.json_name().to_string();
    let repeated = field.is_list();
    let required = field_is_required(field);
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
        let map_value = match field.kind() {
            Kind::Message(entry) => Some(Box::new(field_schema(
                &entry.map_entry_value_field(),
                ancestors,
            ))),
            _ => None,
        };
        return ProtoFieldSchema {
            name,
            kind: "map".to_string(),
            type_name,
            repeated: false,
            required,
            oneof,
            fields: vec![],
            enum_values: vec![],
            map_value,
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
                    required,
                    oneof,
                    fields: vec![],
                    enum_values: vec![],
                    map_value: None,
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
                    required,
                    oneof,
                    fields,
                    enum_values: vec![],
                    map_value: None,
                }
            }
        }
        Kind::Enum(e) => ProtoFieldSchema {
            name,
            kind: "enum".to_string(),
            type_name,
            repeated,
            required,
            oneof,
            fields: vec![],
            enum_values: e.values().map(|v| v.name().to_string()).collect(),
            map_value: None,
        },
        Kind::Bool => ProtoFieldSchema {
            name,
            kind: "bool".to_string(),
            type_name,
            repeated,
            required,
            oneof,
            fields: vec![],
            enum_values: vec![],
            map_value: None,
        },
        Kind::String | Kind::Bytes => ProtoFieldSchema {
            name,
            kind: "string".to_string(),
            type_name,
            repeated,
            required,
            oneof,
            fields: vec![],
            enum_values: vec![],
            map_value: None,
        },
        _ => ProtoFieldSchema {
            name,
            kind: "number".to_string(),
            type_name,
            repeated,
            required,
            oneof,
            fields: vec![],
            enum_values: vec![],
            map_value: None,
        },
    }
}

fn message_schema_fields(message: &MessageDescriptor) -> Vec<ProtoFieldSchema> {
    let mut ancestors = HashSet::new();
    ancestors.insert(message.full_name().to_string());
    message
        .fields()
        .map(|field| field_schema(&field, &ancestors))
        .collect()
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

fn field_is_required(field: &FieldDescriptor) -> bool {
    if field.is_required() {
        return true;
    }
    field.options().extensions().any(|(extension, value)| {
        if extension.full_name() != "google.api.field_behavior" {
            return false;
        }
        let Kind::Enum(enumeration) = extension.kind() else {
            return false;
        };
        let Some(required) = enumeration.get_value_by_name("REQUIRED") else {
            return false;
        };
        matches!(value, Value::List(values) if values.iter().any(|value| matches!(value, Value::EnumNumber(number) if *number == required.number())))
    })
}

fn field_placeholder(field: &FieldDescriptor, ancestors: &HashSet<String>, required_only: bool) -> serde_json::Value {
    if field.is_map() {
        return json!({});
    }

    let single = |kind: &Kind, ancestors: &HashSet<String>| -> serde_json::Value {
        match kind {
            Kind::Message(m) => well_known_placeholder(m).unwrap_or_else(|| message_template(m, ancestors, required_only)),
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

fn message_template(desc: &MessageDescriptor, ancestors: &HashSet<String>, required_only: bool) -> serde_json::Value {
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
        let required = field_is_required(&field);
        if required_only && !required {
            continue;
        }
        // A oneof may be completely unset, but setting multiple alternatives is
        // invalid. Leave real oneofs out of the default template so the generated
        // JSON is always valid and let autocomplete offer the alternatives.
        if field.containing_oneof().is_some_and(|oneof| !oneof.is_synthetic()) && !required {
            continue;
        }
        // Any requires a concrete @type that cannot be inferred from its field
        // descriptor. Leaving it unset is valid; autocomplete still exposes it.
        if matches!(field.kind(), Kind::Message(message) if message.full_name() == "google.protobuf.Any") {
            continue;
        }
        obj.insert(field.json_name().to_string(), field_placeholder(&field, &next, required_only));
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
    let output_desc = method_desc.output();

    let ancestors = HashSet::new();
    let template_value = message_template(&input_desc, &ancestors, true);
    let template = serde_json::to_string_pretty(&template_value).map_err(|e| e.to_string())?;
    let fields = input_desc.fields().map(|f| field_schema(&f, &ancestors)).collect();

    let output_fields = message_schema_fields(&output_desc);

    Ok(GrpcMethodSchema {
        template,
        fields,
        input_type: input_desc.full_name().to_string(),
        output_type: output_desc.full_name().to_string(),
        output_fields,
    })
}

fn metadata_entries(metadata: &tonic::metadata::MetadataMap) -> Vec<(String, String)> {
    metadata
        .iter()
        .filter_map(|kv| match kv {
            tonic::metadata::KeyAndValueRef::Ascii(k, v) => {
                Some((k.to_string(), v.to_str().unwrap_or("<invalid>").to_string()))
            }
            tonic::metadata::KeyAndValueRef::Binary(k, v) => Some((
                k.to_string(),
                format!(
                    "<binary, {} bytes>",
                    v.to_bytes().map(|b| b.len()).unwrap_or(0)
                ),
            )),
        })
        .collect()
}

fn dynamic_message_json(message: &DynamicMessage) -> Result<String, String> {
    let mut buf = Vec::new();
    let mut serializer = serde_json::Serializer::pretty(&mut buf);
    message
        .serialize_with_options(&mut serializer, &prost_reflect::SerializeOptions::new())
        .map_err(|e| format!("failed to serialize response: {e}"))?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

async fn invoke_unary_inner(
    payload: GrpcInvokeRequest,
    deadline: Instant,
    max_response_size: usize,
    compression: Option<CompressionEncoding>,
) -> Result<GrpcInvokeResponse, String> {
    let pool = match (&payload.proto_files, &payload.entry_file) {
        (Some(files), Some(entry_file)) => build_pool_from_proto_files(files, entry_file)?,
        _ => {
            build_pool_for_service_with_wait(&payload.url, &payload.service, payload.wait_for_ready)
                .await?
        }
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
    let mut grpc_client = tonic::client::Grpc::new(channel).max_decoding_message_size(max_response_size);
    if let Some(encoding) = compression {
        grpc_client = grpc_client.send_compressed(encoding).accept_compressed(encoding);
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

    let metadata = metadata_entries(response.metadata());

    let dynamic_response = response.into_inner();

    Ok(GrpcInvokeResponse {
        json: dynamic_message_json(&dynamic_response)?,
        metadata,
        duration_ms,
    })
}

#[tauri::command]
pub async fn grpc_invoke_unary(payload: GrpcInvokeRequest) -> Result<GrpcInvokeResponse, String> {
    let timeout = request_timeout(payload.timeout_ms);
    let max_response_size = max_response_size(payload.max_response_size_bytes)?;
    let compression = compression_encoding(payload.compression.as_deref())?;
    let deadline = Instant::now() + timeout;
    tokio::time::timeout(timeout, invoke_unary_inner(payload, deadline, max_response_size, compression))
        .await
        .map_err(|_| format!("gRPC request deadline exceeded after {} ms", timeout.as_millis()))?
}

async fn invoke_server_stream_inner(
    payload: GrpcInvokeRequest,
    deadline: Instant,
    max_response_size: usize,
    compression: Option<CompressionEncoding>,
    on_event: IpcChannel<GrpcStreamEvent>,
) -> Result<GrpcStreamResponse, String> {
    let started = Instant::now();
    let pool = match (&payload.proto_files, &payload.entry_file) {
        (Some(files), Some(entry_file)) => build_pool_from_proto_files(files, entry_file)?,
        _ => build_pool_for_service_with_wait(&payload.url, &payload.service, payload.wait_for_ready).await?,
    };
    let service_desc = pool
        .get_service_by_name(&payload.service)
        .ok_or_else(|| format!("service {} not found", payload.service))?;
    let method_desc = service_desc
        .methods()
        .find(|method| method.name() == payload.method)
        .ok_or_else(|| format!("method {} not found on {}", payload.method, payload.service))?;
    if method_desc.is_client_streaming() || !method_desc.is_server_streaming() {
        return Err(format!(
            "{}.{} is not a server-streaming method",
            payload.service, payload.method
        ));
    }

    let mut deserializer = serde_json::Deserializer::from_str(&payload.message_json);
    let message = DynamicMessage::deserialize(method_desc.input(), &mut deserializer)
        .map_err(|e| format!("invalid message JSON: {e}"))?;
    deserializer
        .end()
        .map_err(|e| format!("invalid message JSON: {e}"))?;

    let channel = connect_for_request(&payload.url, payload.wait_for_ready).await?;
    let mut grpc_client =
        tonic::client::Grpc::new(channel).max_decoding_message_size(max_response_size);
    if let Some(encoding) = compression {
        grpc_client = grpc_client
            .send_compressed(encoding)
            .accept_compressed(encoding);
    }
    grpc_client
        .ready()
        .await
        .map_err(|e| format!("connection not ready: {e}"))?;

    let path_str = format!("/{}/{}", payload.service, payload.method);
    let path = http::uri::PathAndQuery::from_str(&path_str)
        .map_err(|e| format!("invalid method path: {e}"))?;
    let mut request = Request::new(message);
    request.set_timeout(deadline.saturating_duration_since(Instant::now()));
    for (key, value) in &payload.metadata {
        let metadata_key = tonic::metadata::MetadataKey::from_bytes(key.to_lowercase().as_bytes())
            .map_err(|e| format!("invalid metadata key {key}: {e}"))?;
        let metadata_value = tonic::metadata::MetadataValue::try_from(value.as_str())
            .map_err(|e| format!("invalid metadata value for {key}: {e}"))?;
        request.metadata_mut().insert(metadata_key, metadata_value);
    }

    let codec = DynamicCodec {
        output_desc: method_desc.output(),
    };
    let response = grpc_client
        .server_streaming(request, path, codec)
        .await
        .map_err(|status| format!("gRPC error ({:?}): {}", status.code(), status.message()))?;
    let mut metadata = metadata_entries(response.metadata());
    on_event
        .send(GrpcStreamEvent::Metadata {
            metadata: metadata.clone(),
        })
        .map_err(|_| "gRPC stream listener closed".to_string())?;
    let mut stream = response.into_inner();
    let mut messages = Vec::new();

    loop {
        let next = stream
            .message()
            .await
            .map_err(|status| format!("gRPC error ({:?}): {}", status.code(), status.message()))?;
        let Some(message) = next else { break };
        let json = dynamic_message_json(&message)?;
        on_event
            .send(GrpcStreamEvent::Message { json: json.clone() })
            .map_err(|_| "gRPC stream listener closed".to_string())?;
        messages.push(serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?);
    }

    if let Some(trailers) = stream
        .trailers()
        .await
        .map_err(|status| format!("gRPC error ({:?}): {}", status.code(), status.message()))?
    {
        metadata.extend(metadata_entries(&trailers));
    }

    let json = serde_json::to_string_pretty(&messages).map_err(|e| e.to_string())?;
    Ok(GrpcStreamResponse {
        size_bytes: json.len(),
        message_count: messages.len(),
        json,
        metadata,
        duration_ms: started.elapsed().as_millis() as u64,
        cancelled: false,
    })
}

#[tauri::command]
pub async fn grpc_invoke_server_stream(
    request_id: String,
    payload: GrpcInvokeRequest,
    on_event: IpcChannel<GrpcStreamEvent>,
    state: State<'_, GrpcStreamState>,
) -> Result<GrpcStreamResponse, String> {
    let timeout = request_timeout(payload.timeout_ms);
    let max_response_size = max_response_size(payload.max_response_size_bytes)?;
    let compression = compression_encoding(payload.compression.as_deref())?;
    let deadline = Instant::now() + timeout;
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    {
        let mut cancellations = state
            .cancellations
            .lock()
            .map_err(|_| "gRPC cancellation state is unavailable")?;
        if cancellations.contains_key(&request_id) {
            return Err("a gRPC stream with this request id is already running".to_string());
        }
        cancellations.insert(request_id.clone(), cancel_tx);
    }

    let started = Instant::now();
    let operation = tokio::time::timeout(
        timeout,
        invoke_server_stream_inner(payload, deadline, max_response_size, compression, on_event),
    );
    tokio::pin!(operation);
    let result = tokio::select! {
        result = &mut operation => match result {
            Ok(result) => result,
            Err(_) => Err(format!("gRPC request deadline exceeded after {} ms", timeout.as_millis())),
        },
        changed = cancel_rx.changed() => {
            if changed.is_ok() && *cancel_rx.borrow() {
                Ok(GrpcStreamResponse {
                    json: "[]".to_string(),
                    metadata: vec![],
                    duration_ms: started.elapsed().as_millis() as u64,
                    size_bytes: 2,
                    message_count: 0,
                    cancelled: true,
                })
            } else {
                Err("gRPC cancellation channel closed".to_string())
            }
        }
    };
    if let Ok(mut cancellations) = state.cancellations.lock() {
        cancellations.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn grpc_cancel_stream(
    request_id: String,
    state: State<'_, GrpcStreamState>,
) -> Result<bool, String> {
    let cancellations = state
        .cancellations
        .lock()
        .map_err(|_| "gRPC cancellation state is unavailable")?;
    Ok(cancellations
        .get(&request_id)
        .map(|cancel| cancel.send(true).is_ok())
        .unwrap_or(false))
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
    fn service_catalog_includes_an_importable_message_template() {
        let files = vec![ProtoFileInput { name: "test.proto".to_string(), content: TEST_PROTO.to_string() }];
        let services = grpc_list_services_from_proto(files, "test.proto".to_string()).expect("catalog should build");
        let method = &services[0].methods[0];

        assert_eq!(services[0].name, "test.PetService");
        assert_eq!(method.name, "CreatePet");
        assert_eq!(method.method_type, "unary");
        let template: serde_json::Value = serde_json::from_str(&method.template).expect("template should be JSON");
        assert_eq!(template, json!({}), "proto3 fields without REQUIRED behavior should be omitted");
    }

    #[test]
    fn required_only_template_keeps_proto2_required_fields() {
        let source = r#"
            syntax = "proto2";
            package required_test;

            message Input {
                required string name = 1;
                optional string nickname = 2;
                repeated string tags = 3;
            }

            service RequiredService {
                rpc Call(Input) returns (Input);
            }
        "#;
        let files = vec![ProtoFileInput { name: "required.proto".to_string(), content: source.to_string() }];
        let services = grpc_list_services_from_proto(files, "required.proto".to_string()).expect("catalog should build");
        let template: serde_json::Value = serde_json::from_str(&services[0].methods[0].template).expect("template should be JSON");

        assert_eq!(template, json!({ "name": "" }));
    }

    #[test]
    fn generates_template_and_schema_for_all_field_kinds() {
        let pool = test_pool();
        let service = pool.get_service_by_name("test.PetService").unwrap();
        let method = service.methods().find(|m| m.name() == "CreatePet").unwrap();
        let input = method.input();

        let ancestors = HashSet::new();
        let template = message_template(&input, &ancestors, false);
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

        let metadata_field = fields.iter().find(|f| f.name == "metadata").unwrap();
        let map_value = metadata_field.map_value.as_ref().expect("map value schema");
        assert_eq!(map_value.kind, "string");
        assert_eq!(map_value.type_name, "string");

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
        let template = message_template(&node, &ancestors, false);
        assert!(template.is_object());
    }

    #[test]
    fn invoke_settings_use_safe_defaults_and_validate_bounds() {
        assert_eq!(request_timeout(None), Duration::from_millis(DEFAULT_REQUEST_TIMEOUT_MS));
        assert_eq!(request_timeout(Some(0)), Duration::from_millis(DEFAULT_REQUEST_TIMEOUT_MS));
        assert_eq!(request_timeout(Some(1_500)), Duration::from_millis(1_500));

        assert_eq!(max_response_size(None).unwrap(), DEFAULT_MAX_RESPONSE_SIZE);
        assert!(max_response_size(Some(0)).is_err());
        assert!(max_response_size(Some(MAX_RESPONSE_SIZE + 1)).is_err());
        assert_eq!(max_response_size(Some(8 * 1024 * 1024)).unwrap(), 8 * 1024 * 1024);

        assert!(compression_encoding(None).unwrap().is_none());
        assert!(matches!(compression_encoding(Some("gzip")), Ok(Some(CompressionEncoding::Gzip))));
        assert!(compression_encoding(Some("brotli")).is_err());
    }

    #[test]
    fn older_invoke_payloads_deserialize_without_settings() {
        let payload: GrpcInvokeRequest = serde_json::from_value(json!({
            "url": "grpc://localhost:50051",
            "service": "test.PetService",
            "method": "CreatePet",
            "message_json": "{}"
        }))
        .expect("legacy payload should deserialize");

        assert_eq!(payload.timeout_ms, None);
        assert!(!payload.wait_for_ready);
        assert_eq!(payload.compression, None);
        assert_eq!(payload.max_response_size_bytes, None);
    }
}
