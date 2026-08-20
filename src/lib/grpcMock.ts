import { GrpcLogEntry, GrpcMethodType, GrpcRequestData, uid } from "../types";

export interface GrpcMethodDef {
  name: string;
  methodType: GrpcMethodType;
  requestExample: string;
}

export interface GrpcServiceDef {
  name: string;
  methods: GrpcMethodDef[];
}

export const MOCK_GRPC_SERVICES: GrpcServiceDef[] = [
  {
    name: "helloworld.Greeter",
    methods: [
      { name: "SayHello", methodType: "unary", requestExample: '{\n  "name": "Relay"\n}' },
      { name: "SayHelloStream", methodType: "server-stream", requestExample: '{\n  "name": "Relay"\n}' },
    ],
  },
  {
    name: "chat.ChatService",
    methods: [
      {
        name: "SendMessages",
        methodType: "client-stream",
        requestExample: '[\n  { "user": "alice", "text": "hi" },\n  { "user": "alice", "text": "how are you?" }\n]',
      },
      {
        name: "Chat",
        methodType: "bidi",
        requestExample: '[\n  { "user": "alice", "text": "hi" },\n  { "user": "alice", "text": "still there?" }\n]',
      },
    ],
  },
];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockReplyFor(method: string, sentJson: any): any {
  if (method === "SayHello" || method === "SayHelloStream") {
    const name = typeof sentJson?.name === "string" ? sentJson.name : "world";
    return { message: `Hello, ${name}!` };
  }
  if (method === "SendMessages") {
    return { count: Array.isArray(sentJson) ? sentJson.length : 0 };
  }
  return { echo: sentJson };
}

export async function simulateGrpcCall(
  req: GrpcRequestData,
  onChunk: (entry: GrpcLogEntry) => void,
  isCancelled: () => boolean
): Promise<void> {
  let parsed: any;
  try {
    parsed = JSON.parse(req.messageJson);
  } catch (e: any) {
    onChunk({ id: uid(), timestamp: Date.now(), direction: "error", json: `Invalid JSON message: ${e.message}` });
    return;
  }

  if (req.methodType === "unary") {
    onChunk({ id: uid(), timestamp: Date.now(), direction: "sent", json: JSON.stringify(parsed, null, 2) });
    await wait(400);
    if (isCancelled()) return;
    onChunk({ id: uid(), timestamp: Date.now(), direction: "received", json: JSON.stringify(mockReplyFor(req.method, parsed), null, 2) });
    return;
  }

  if (req.methodType === "server-stream") {
    onChunk({ id: uid(), timestamp: Date.now(), direction: "sent", json: JSON.stringify(parsed, null, 2) });
    for (let i = 1; i <= 3; i++) {
      await wait(350);
      if (isCancelled()) return;
      const reply = mockReplyFor(req.method, parsed);
      onChunk({ id: uid(), timestamp: Date.now(), direction: "received", json: JSON.stringify({ ...reply, seq: i }, null, 2) });
    }
    return;
  }

  const messages: any[] = Array.isArray(parsed) ? parsed : [parsed];

  if (req.methodType === "client-stream") {
    for (const msg of messages) {
      await wait(250);
      if (isCancelled()) return;
      onChunk({ id: uid(), timestamp: Date.now(), direction: "sent", json: JSON.stringify(msg, null, 2) });
    }
    await wait(300);
    if (isCancelled()) return;
    onChunk({ id: uid(), timestamp: Date.now(), direction: "received", json: JSON.stringify(mockReplyFor(req.method, messages), null, 2) });
    return;
  }

  // bidi
  for (const msg of messages) {
    await wait(250);
    if (isCancelled()) return;
    onChunk({ id: uid(), timestamp: Date.now(), direction: "sent", json: JSON.stringify(msg, null, 2) });
    await wait(250);
    if (isCancelled()) return;
    onChunk({ id: uid(), timestamp: Date.now(), direction: "received", json: JSON.stringify(mockReplyFor(req.method, msg), null, 2) });
  }
}
