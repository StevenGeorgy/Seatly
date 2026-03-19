import { existsSync, readFileSync } from "fs";
import path from "path";
import { config as loadEnv } from "dotenv";

function isSeatlyMonorepoRoot(dir: string): boolean {
  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
      workspaces?: unknown;
    };
    return pkg.name === "seatly" && Array.isArray(pkg.workspaces);
  } catch {
    return false;
  }
}

/** Do not use import.meta.url here — bundled path breaks discovery. Walk from cwd. */
export function loadMonorepoEnv(): void {
  const seen = new Set<string>();
  const load = (p: string) => {
    if (existsSync(p) && !seen.has(p)) {
      seen.add(p);
      loadEnv({ path: p, override: true });
    }
  };

  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (isSeatlyMonorepoRoot(dir)) {
      load(path.join(dir, ".env.local"));
      load(path.join(dir, ".env"));
      load(path.join(dir, "apps", "web", ".env.local"));
      load(path.join(dir, "apps", "web", ".env"));
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const cwd = process.cwd();
  for (const name of [".env.local", ".env"] as const) {
    load(path.join(cwd, name));
    load(path.join(cwd, "..", "..", name));
    load(path.join(cwd, "..", name));
  }
}
