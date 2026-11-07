/**
 * Serves the built app (dist) the way Vercel does, from vercel.json: its
 * headers (the content security policy among them) and trailing-slash
 * rule, with a 404 status for anything that is not a file (the app is one
 * page). `vite preview` ignores vercel.json, so the policy would go
 * untested there. The website's scripts/preview.ts, for one page.
 *
 * Usage: bun scripts/preview.ts [--port 4173] [dist]   (bun run preview)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

interface VercelConfig {
  trailingSlash?: boolean;
  headers?: { source: string; headers: { key: string; value: string }[] }[];
}

const escape = (s: string) => s.replace(/[.+?^${}|[\]\\*]/g, "\\$&");

/** A vercel.json source as a regular expression: groups ("/(.*)") are kept, the rest is literal. */
export function sourceToRegExp(source: string): RegExp {
  let pattern = "";
  for (let i = 0; i < source.length; ) {
    if (source[i] === "(") {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === "(") depth++;
        else if (source[j] === ")" && --depth === 0) break;
      }
      pattern += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    pattern += escape(source[i]);
    i++;
  }
  return new RegExp(`^${pattern}$`);
}

/** The headers vercel.json sets for a path, later rules overriding earlier ones. */
export function headersFor(config: VercelConfig, pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of config.headers ?? []) {
    if (sourceToRegExp(rule.source).test(pathname)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Starts the server on 127.0.0.1; port 0 picks a free port. Resolves to its URL. */
export function startPreview({ dist = "dist", port = 4173 }: { dist?: string; port?: number } = {}): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const root = resolve(import.meta.dirname, "..");
  const dir = resolve(root, dist);
  if (!existsSync(join(dir, "index.html"))) throw new Error(`${dir} has no index.html: run bun run build first`);
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as VercelConfig;
  const server = createServer((req, res) => {
    const { pathname, search } = new URL(req.url ?? "/", "http://localhost");
    const headers = headersFor(config, pathname);
    if (config.trailingSlash === false && pathname.length > 1 && pathname.endsWith("/")) {
      res.writeHead(308, { ...headers, Location: pathname.replace(/\/+$/, "") + search }).end();
      return;
    }
    const file = normalize(join(dir, decodeURIComponent(pathname === "/" ? "/index.html" : pathname)));
    const inside = file === dir || file.startsWith(dir + sep);
    if (!inside || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end(req.method === "HEAD" ? undefined : "Not found");
      return;
    }
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { ...headers, "Content-Type": type }).end(req.method === "HEAD" ? undefined : readFileSync(file));
  });
  return new Promise((done) =>
    server.listen(port, "127.0.0.1", () => {
      const { port: actual } = server.address() as AddressInfo;
      done({
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise<void>((closed) => server.close(() => closed())),
      });
    }),
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const p = args.indexOf("--port");
  const port = p >= 0 ? Number(args.splice(p, 2)[1]) : Number(process.env.PORT ?? 4173);
  const { url } = await startPreview({ dist: args[0], port });
  console.log(`Serving dist as Vercel does at ${url}`);
}
