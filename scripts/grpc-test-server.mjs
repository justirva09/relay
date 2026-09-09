import { createServer, constants } from "node:http2";
import { gunzipSync } from "node:zlib";

const HOST = "127.0.0.1";
const PORT = Number(process.env.RELAY_GRPC_TEST_PORT || 50051);
const METHOD = "/relay.testing.StreamService/Watch";

function encodeVarint(value) {
  const bytes = [];
  let remaining = Math.max(0, Number(value) >>> 0);
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function readVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  while (offset < buffer.length && shift < 35) {
    const byte = buffer[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, offset];
    shift += 7;
  }
  throw new Error("invalid protobuf varint");
}

function decodeWatchRequest(frame) {
  if (frame.length < 5) throw new Error("missing gRPC message frame");
  const compressed = frame[0] === 1;
  const length = frame.readUInt32BE(1);
  let payload = frame.subarray(5, 5 + length);
  if (payload.length !== length) throw new Error("incomplete gRPC message frame");
  if (compressed) payload = gunzipSync(payload);

  const request = { name: "Relay", count: 5, delayMs: 300 };
  let offset = 0;
  while (offset < payload.length) {
    let tag;
    [tag, offset] = readVarint(payload, offset);
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 2) {
      let size;
      [size, offset] = readVarint(payload, offset);
      const value = payload.subarray(offset, offset + size);
      offset += size;
      if (field === 1) request.name = value.toString("utf8");
    } else if (wireType === 0) {
      let value;
      [value, offset] = readVarint(payload, offset);
      if (field === 2) request.count = value;
      if (field === 3) request.delayMs = value;
    } else {
      throw new Error(`unsupported protobuf wire type ${wireType}`);
    }
  }
  request.count = Math.min(100, Math.max(1, request.count || 5));
  request.delayMs = Math.min(10_000, Math.max(10, request.delayMs || 300));
  return request;
}

function encodeWatchReply(name, sequence) {
  const message = Buffer.from(`Hello, ${name || "Relay"}!`, "utf8");
  return Buffer.concat([
    Buffer.from([0x0a]),
    encodeVarint(message.length),
    message,
    Buffer.from([0x10]),
    encodeVarint(sequence),
  ]);
}

function grpcFrame(payload) {
  const header = Buffer.alloc(5);
  header.writeUInt8(0, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const server = createServer();

server.on("stream", (stream, headers) => {
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk));
  stream.on("error", () => {});
  stream.on("end", async () => {
    if (headers[constants.HTTP2_HEADER_PATH] !== METHOD) {
      stream.respond(
        { [constants.HTTP2_HEADER_STATUS]: 200, "content-type": "application/grpc" },
        { waitForTrailers: true }
      );
      stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "12", "grpc-message": "unimplemented" }));
      stream.end();
      return;
    }

    try {
      const request = decodeWatchRequest(Buffer.concat(chunks));
      stream.respond(
        {
          [constants.HTTP2_HEADER_STATUS]: 200,
          "content-type": "application/grpc",
          "x-relay-fixture": "server-stream",
        },
        { waitForTrailers: true }
      );
      stream.on("wantTrailers", () => {
        if (!stream.destroyed) stream.sendTrailers({ "grpc-status": "0", "x-relay-stream": "complete" });
      });
      for (let sequence = 1; sequence <= request.count; sequence++) {
        await wait(request.delayMs);
        if (stream.destroyed || stream.closed) return;
        stream.write(grpcFrame(encodeWatchReply(request.name, sequence)));
      }
      stream.end();
    } catch (error) {
      if (stream.destroyed) return;
      stream.respond(
        { [constants.HTTP2_HEADER_STATUS]: 200, "content-type": "application/grpc" },
        { waitForTrailers: true }
      );
      stream.on("wantTrailers", () =>
        stream.sendTrailers({ "grpc-status": "3", "grpc-message": encodeURIComponent(String(error.message || error)) })
      );
      stream.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Relay gRPC streaming fixture listening on grpc://${HOST}:${PORT}\n`);
  process.stdout.write(`Import fixtures/grpc/streaming.proto and call relay.testing.StreamService/Watch\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
