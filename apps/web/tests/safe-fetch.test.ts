import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import https from "node:https";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { safeFetch, SafeFetchError } from "../src/lib/server/safe-fetch";

// A stand-in for https.request, as in capsule's tests, so no socket is ever opened.
function simulatedRequest(
  reply: { status?: number; headers?: Record<string, string>; chunks?: Buffer[] },
  inspect: (options: RequestOptions & { servername?: string }) => void = () => {},
): typeof https.request {
  return ((options: RequestOptions) => {
    inspect(options);
    const request = new EventEmitter() as ClientRequest;
    request.destroy = (() => request) as typeof request.destroy;
    request.end = (() => {
      queueMicrotask(() => {
        const response = new PassThrough() as unknown as IncomingMessage;
        response.statusCode = reply.status ?? 200;
        response.headers = reply.headers ?? { "content-type": "text/html" };
        request.emit("response", response);
        const stream = response as unknown as PassThrough;
        for (const chunk of reply.chunks ?? [Buffer.from("<title>page</title>")]) if (!stream.destroyed) stream.write(chunk);
        if (!stream.destroyed) stream.end();
      });
      return request;
    }) as typeof request.end;
    return request;
  }) as typeof https.request;
}

test("connects to the checked address while keeping the site's name for TLS", async (context) => {
  let lookups = 0;
  context.mock.method(dns, "lookup", async () => { lookups++; return [{ address: "1.1.1.1", family: 4 }]; });
  context.mock.method(https, "request", simulatedRequest({}, (options) => {
    assert.equal(options.hostname, "1.1.1.1");
    assert.equal(options.servername, "news.example.com");
    assert.equal((options.headers as Record<string, string>).Host, "news.example.com");
  }));
  assert.equal((await safeFetch("https://news.example.com/story")).body.toString(), "<title>page</title>");
  assert.equal(lookups, 1, "the socket doesn't look the name up again");
});

test("a redirect into a private network is refused before it's followed", async (context) => {
  context.mock.method(dns, "lookup", async () => [{ address: "1.1.1.1", family: 4 }]);
  let requests = 0;
  context.mock.method(https, "request", simulatedRequest({ status: 302, headers: { location: "http://169.254.169.254/latest" } }, () => { requests++; }));
  await assert.rejects(safeFetch("https://news.example.com/story"), (error: unknown) => error instanceof SafeFetchError && error.code === "BLOCKED_URL");
  assert.equal(requests, 1);
});

test("reading stops after the head, or at the size limit, without failing", async (context) => {
  context.mock.method(dns, "lookup", async () => [{ address: "1.1.1.1", family: 4 }]);
  context.mock.method(https, "request", simulatedRequest({ chunks: [Buffer.from("<head><title>t</title></HE"), Buffer.from("AD><body>"), Buffer.alloc(4096, "x")] }));
  const early = await safeFetch("https://news.example.com/a", { stopAfter: "</head>" });
  assert.equal(early.body.toString(), "<head><title>t</title></HEAD><body>");
  context.mock.method(https, "request", simulatedRequest({ headers: { "content-type": "text/html", "content-encoding": "gzip" }, chunks: [gzipSync(Buffer.alloc(4096, "y"))] }));
  const bounded = await safeFetch("https://news.example.com/b", { maxBytes: 100 });
  assert.equal(bounded.body.length, 100);
});
