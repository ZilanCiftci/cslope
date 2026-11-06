/**
 * Serves the built site (dist) the way Vercel does, from vercel.json:
 * its headers (the content security policy among them), redirects,
 * trailing-slash rule and rewrites, with dist/404.html and a 404 status
 * for anything else. `vite preview` ignores vercel.json and serves the home
 * page's HTML for every URL, so a page hydrates with the wrong HTML there.
 *
 * Usage: bun scripts/preview.ts [--port 4173] [dist]   (bun run preview)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

interface VercelConfig {
  trailingSlash?: boolean;
  redirects?: { source: string; destination: string; permanent?: boolean }[];
  rewrites?: { source: string; destination: string }[];
  headers?: { source: string; headers: { key: string; value: string }[] }[];
}

const escape = (s: string) => s.replace(/[.+?^${}|[\]\\*]/g, "\\$&");

/**
 * A vercel.json source as a regular expression: groups ("/(.*)") are kept
 * as regular expressions, ":name*" matches any rest of the path and
 * ":name" one segment; the rest is literal.
 */
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
    const param = source.slice(i).match(/^:\w+(\*)?/);
    if (param) {
      pattern += param[1] ? "(.*)" : "([^/]+)";
      i += param[0].length;
      continue;
    }
    pattern += escape(source[i]);
    i++;
  }
  return new RegExp(`^${pattern}$`);
}

/** The destination with $1, $2… replaced by the source's groups. */
const substitute = (destination: string, match: RegExpMatchArray) =>
  destination.replace(/\$(\d+)/g, (_, n: string) => match[Number(n)] ?? "");

export type Resolution =
  | { kind: "redirect"; location: string; status: number }
  | { kind: "file"; file: string; status: number };

/** What Vercel answers for a path: a redirect, or a file of dist with its status. */
export function resolvePath(config: VercelConfig, dist: string, pathname: string): Resolution {
  for (const r of config.redirects ?? []) {
    const m = pathname.match(sourceToRegExp(r.source));
    if (m) return { kind: "redirect", location: substitute(r.destination, m), status: r.permanent ? 308 : 307 };
  }
  if (config.trailingSlash === false && pathname.length > 1 && pathname.endsWith("/")) {
    return { kind: "redirect", location: pathname.replace(/\/+$/, ""), status: 308 };
  }
  const fileAt = (path: string): string | null => {
    const file = normalize(join(dist, decodeURIComponent(path)));
    if (file !== dist && !file.startsWith(dist + sep)) return null;
    return existsSync(file) && statSync(file).isFile() ? file : null;
  };
  // Files first, then the rewrites (Vercel's order for a static site).
  const direct = fileAt(pathname);
  if (direct) return { kind: "file", file: direct, status: 200 };
  for (const r of config.rewrites ?? []) {
    const m = pathname.match(sourceToRegExp(r.source));
    const file = m && fileAt(substitute(r.destination, m));
    if (file) return { kind: "file", file, status: 200 };
  }
  return { kind: "file", file: join(dist, "404.html"), status: 404 };
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
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
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
    const r = resolvePath(config, dir, pathname);
    if (r.kind === "redirect") {
      res.writeHead(r.status, { ...headers, Location: r.location + search }).end();
      return;
    }
    const type = TYPES[extname(r.file).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(r.status, { ...headers, "Content-Type": type }).end(req.method === "HEAD" ? undefined : readFileSync(r.file));
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
