// Ambient type shims so the Cursor / VS Code TypeScript language service
// stops underlining Deno globals and `npm:`/`jsr:` imports in our Supabase
// Edge Functions. These are only for editor diagnostics — at runtime the
// Deno edge runtime resolves these natively.

declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
  };

  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): void;
  export function serve(
    opts: { port?: number; hostname?: string },
    handler: (req: Request) => Response | Promise<Response>,
  ): void;
}

// ── Remote specifiers used by Supabase Edge Functions ────────────────────────
// We declare the specific packages we use so they resolve with a real value
// export. A blanket `declare module "npm:*"` would make every import a
// namespace (breaking `new OpenAI(...)` etc.), so we do it per-package.

declare module "npm:openai@4" {
  // Class + namespace declaration merging: OpenAI can be `new`-ed AND used
  // as a namespace for its own types (`OpenAI.Chat.ChatCompletionTool`).
  class OpenAI {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(config: any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }
  namespace OpenAI {
    namespace Chat {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type ChatCompletionTool = any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type ChatCompletionMessageParam = any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type ChatCompletionToolMessageParam = any;
    }
  }
  export default OpenAI;
}

declare module "npm:stripe@17" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Stripe: any;
  export default Stripe;
}

// Catch-all for any other `jsr:` / `https:` specifier we might add later.
declare module "jsr:*";
declare module "https://*";
