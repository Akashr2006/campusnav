/**
 * Local HTTP/2 server for drone mesh folders, for the load benchmark
 * (bench-mesh.mjs). It answers the way the Cloudflare CDN does, so timings
 * under throttling are comparable: HTTP/2 multiplexing, brotli on JSON only,
 * `max-age=3600` on JSON and `immutable` on tiles, CORS, plus
 * Timing-Allow-Origin so the page can read transfer sizes.
 *
 *   node tools/drone/mesh-server.mjs --port 5443 [--http-port 5480] v1="E:/BIT 3D/_work/web-mesh" v2="E:/BIT 3D/_work/web-mesh-v2"
 *
 * Each name=dir pair is served under /name/. The certificate is self-signed;
 * the benchmark starts Chrome with --ignore-certificate-errors.
 */
import http2 from "node:http2";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import selfsigned from "selfsigned";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 5443;
const mounts = Object.fromEntries(
  args.filter((a) => a.includes("=") && !a.startsWith("--")).map((a) => {
    const i = a.indexOf("=");
    return [a.slice(0, i), path.resolve(a.slice(i + 1))];
  })
);
if (!Object.keys(mounts).length) throw new Error("give at least one name=dir mount");

const pems = selfsigned.generate([{ name: "commonName", value: "localhost" }], { days: 30, keySize: 2048 });
const brCache = new Map();

const TYPES = { ".json": "application/json", ".b3dm": "application/octet-stream", ".glb": "model/gltf-binary", ".webp": "image/webp" };

const server = http2.createSecureServer({ key: pems.private, cert: pems.cert, allowHTTP1: true });
server.on("stream", serve);

// Chrome never caches responses on a certificate error, so repeat-visit runs
// need a plain-HTTP twin (--http-port). HTTP/1.1 only, but cache hits do not
// care about multiplexing.
const httpPort = Number(args[args.indexOf("--http-port") + 1]) || 0;
if (httpPort) {
  const http = await import("node:http");
  http
    .createServer((req, res) => {
      const stream = {
        respond: (h) => {
          const { ":status": status, ...rest } = h;
          res.writeHead(status, rest);
        },
        end: (body) => res.end(body),
      };
      serve(stream, { ":method": req.method, ":path": req.url, "accept-encoding": req.headers["accept-encoding"] });
    })
    .listen(httpPort, () => console.log(`plain http on http://localhost:${httpPort}/`));
}

function serve(stream, headers) {
  const method = headers[":method"];
  const url = decodeURIComponent((headers[":path"] ?? "/").split("?")[0]);
  const [, mount, ...rest] = url.split("/");
  const common = {
    "access-control-allow-origin": "*",
    "timing-allow-origin": "*",
  };
  if (method === "OPTIONS") return stream.respond({ ":status": 204, ...common, "access-control-allow-headers": "*" }) || stream.end();
  const root = mounts[mount];
  const file = root && path.join(root, ...rest);
  if (!file || !file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    stream.respond({ ":status": 404, ...common });
    return stream.end();
  }
  const ext = path.extname(file).toLowerCase();
  const head = {
    ":status": 200,
    ...common,
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "cache-control": ext === ".json" ? "public, max-age=3600" : "public, max-age=31536000, immutable",
  };
  let body = fs.readFileSync(file);
  if (ext === ".json" && /\bbr\b/.test(headers["accept-encoding"] ?? "")) {
    if (!brCache.has(file)) brCache.set(file, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }));
    body = brCache.get(file);
    head["content-encoding"] = "br";
  }
  head["content-length"] = body.length;
  stream.respond(head);
  stream.end(method === "HEAD" ? undefined : body);
}
server.listen(port, () => console.log(`mesh server https://localhost:${port}/ ${Object.entries(mounts).map(([k, v]) => `/${k}/ -> ${v}`).join(", ")}`));
