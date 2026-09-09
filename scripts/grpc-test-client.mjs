import { connect, constants } from "node:http2";

const PORT = Number(process.env.RELAY_GRPC_TEST_PORT || 50051);
const client = connect(`http://127.0.0.1:${PORT}`);
const request = client.request({
  [constants.HTTP2_HEADER_METHOD]: "POST",
  [constants.HTTP2_HEADER_PATH]: "/relay.testing.StreamService/Watch",
  "content-type": "application/grpc",
  te: "trailers",
});

// WatchRequest { name: "Test", count: 3, delay_ms: 10 }
const payload = Buffer.from([0x0a, 0x04, 0x54, 0x65, 0x73, 0x74, 0x10, 0x03, 0x18, 0x0a]);
const frame = Buffer.alloc(5 + payload.length);
frame.writeUInt32BE(payload.length, 1);
payload.copy(frame, 5);

const chunks = [];
let trailers = {};
request.on("data", (chunk) => chunks.push(chunk));
request.on("trailers", (value) => {
  trailers = value;
});
request.on("error", (error) => {
  client.destroy();
  throw error;
});
request.on("end", () => {
  const body = Buffer.concat(chunks);
  let offset = 0;
  let messages = 0;
  while (offset + 5 <= body.length) {
    const size = body.readUInt32BE(offset + 1);
    offset += 5 + size;
    messages += 1;
  }

  const result = {
    messages,
    grpcStatus: trailers["grpc-status"],
    fixtureTrailer: trailers["x-relay-stream"],
  };
  client.close();
  if (result.messages !== 3 || result.grpcStatus !== "0" || result.fixtureTrailer !== "complete") {
    process.stderr.write(`Fixture self-test failed: ${JSON.stringify(result)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Fixture self-test passed: ${JSON.stringify(result)}\n`);
});

request.end(frame);
