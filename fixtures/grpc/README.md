# Local gRPC server-streaming fixture

This fixture provides a deterministic server-streaming endpoint without server reflection or external dependencies.

Start the cleartext HTTP/2 server from the repository root:

```bash
npm run grpc:test-server
```

Optionally verify the fixture protocol from another terminal:

```bash
npm run grpc:test-client
```

To exercise Relay manually:

1. Start Relay with `npm run tauri dev`.
2. Create a gRPC request with URL `grpc://127.0.0.1:50051`.
3. Open **Service definition**, choose **Imported .proto**, and import the `fixtures/grpc` folder.
4. Select `relay.testing.StreamService/Watch`.
5. Send this message:

   ```json
   {
     "name": "Relay",
     "count": 10,
     "delayMs": 300
   }
   ```

Messages should appear one at a time in the Log. The completed Response body should be a JSON array, and Metadata should include `x-relay-fixture: server-stream` and `x-relay-stream: complete`.

Use a larger `count` or `delayMs` to test the **Stop** button. Use a deadline shorter than the total stream duration to test `DEADLINE EXCEEDED`.

Set `RELAY_GRPC_TEST_PORT` in both fixture terminals to use a port other than `50051`.
