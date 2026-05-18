import { z } from "zod";

export interface ParseFailure {
  response: Response;
}

export interface ParseSuccess<T> {
  data: T;
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

interface JsonResLike {
  (body: unknown, status?: number, req?: Request): Response;
}

const DEFAULT_JSON_RES: JsonResLike = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export interface ParseJsonBodyOptions {
  jsonRes?: JsonResLike;
  maxBytes?: number;
}

const ONE_MB = 1024 * 1024;

export async function parseJsonBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
  options: ParseJsonBodyOptions = {},
): Promise<ParseResult<z.infer<T>>> {
  const jsonRes = options.jsonRes ?? DEFAULT_JSON_RES;
  const maxBytes = options.maxBytes ?? ONE_MB;

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    return {
      response: jsonRes(
        { error: "Request body too large", max_bytes: maxBytes },
        413,
        req,
      ),
    };
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return {
      response: jsonRes({ error: "Failed to read request body" }, 400, req),
    };
  }

  if (raw.length > maxBytes) {
    return {
      response: jsonRes(
        { error: "Request body too large", max_bytes: maxBytes },
        413,
        req,
      ),
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    return {
      response: jsonRes({ error: "Invalid JSON" }, 400, req),
    };
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    return {
      response: jsonRes(
        {
          error: "Validation failed",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
            message: issue.message,
          })),
        },
        400,
        req,
      ),
    };
  }

  return { data: result.data };
}
