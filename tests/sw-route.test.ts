import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

// public/sw.js decides which requests it keeps on the device and how. It is a
// plain script, so it runs here in a sandbox with a stand-in `self`.
const ORIGIN = "https://campusnav-rose.vercel.app";
const CDN = "https://campusnav-drone.akashr-ad24.workers.dev";
const sandbox: Record<string, unknown> = {
  self: { location: { origin: ORIGIN }, addEventListener: () => {} },
  URL,
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(resolve(__dirname, "../public/sw.js"), "utf-8"), sandbox);
const route = (url: string) => (sandbox.route as (u: URL) => [string, string] | null)(new URL(url));

describe("the service worker's routes", () => {
  it("keeps the mesh tiles, photo tiles and tour photos, from the cache first", () => {
    expect(route(`${CDN}/BlockBA/BlockBA_L21_1.b3dm`)).toEqual(["tiles", "first"]);
    expect(route(`${CDN}/BlockYX/BlockYX_L17_3.json`)).toEqual(["tiles", "first"]);
    expect(route(`${CDN}/ortho-hd/0/25_31.webp`)).toEqual(["photo", "first"]);
    expect(route(`${CDN}/ortho/2/7_9.webp`)).toEqual(["photo", "first"]);
    expect(route(`${CDN}/tour/32/f.jpg`)).toEqual(["tour", "first"]);
    expect(route(`${ORIGIN}/draco/draco_decoder.wasm`)).toEqual(["data", "first"]);
  });

  it("serves what a deploy changes from the cache but refreshes it", () => {
    expect(route(`${CDN}/tileset.json`)).toEqual(["data", "fresh"]);
    expect(route(`${CDN}/ortho-hd/meta.json`)).toEqual(["photo", "fresh"]);
    expect(route(`${ORIGIN}/drone/paths.json`)).toEqual(["data", "fresh"]);
    expect(route(`${ORIGIN}/drone/landcover.json`)).toEqual(["data", "fresh"]);
    expect(route(`${ORIGIN}/drone/poster/wide.avif`)).toEqual(["data", "fresh"]);
  });

  it("leaves pages, the app's code and everything else to the browser", () => {
    expect(route(`${ORIGIN}/navigate`)).toBeNull();
    expect(route(`${ORIGIN}/_next/static/chunks/main.js`)).toBeNull();
    expect(route(`${ORIGIN}/api/published-graph`)).toBeNull();
    expect(route(`https://example.com/draco/draco_decoder.wasm`)).toBeNull();
  });
});
