import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import type { OpenAPIV3 } from "openapi-types";

async function routeSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      sources.push(...(await routeSources(path)));
    } else if (entry.name.endsWith(".ts")) {
      sources.push(await readFile(path, "utf8"));
    }
  }

  return sources;
}

export async function apiContract(serverDirectory = "server") {
  const document = (await SwaggerParser.validate(
    "openapi.yaml",
  )) as OpenAPIV3.Document;

  for (const source of await routeSources(serverDirectory)) {
    for (const [, method, route] of source.matchAll(
      /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g,
    )) {
      const path = route!.replace(/:([a-zA-Z]+)/g, "{$1}");
      const operation = document.paths[path]?.[method as OpenAPIV3.HttpMethods];
      assert.ok(operation, `Undocumented ${method!.toUpperCase()} ${path}`);
    }
  }

  const ajv = new Ajv({ allErrors: true });
  addFormats.default(ajv);
  const validators = new Map<string, ReturnType<typeof ajv.compile>>();

  return {
    document,
    async response(path: string, response: Response) {
      const operation = document.paths[path]?.get;
      assert.ok(operation, `Undocumented GET ${path}`);

      const contract = operation.responses[
        String(response.status)
      ] as OpenAPIV3.ResponseObject;

      assert.ok(contract, `Undocumented GET ${path} status ${response.status}`);

      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/json/,
      );

      const key = `${path}:${response.status}`;
      let validate = validators.get(key);

      if (!validate) {
        const schema = contract.content?.["application/json"]?.schema;
        assert.ok(schema, `Missing response schema for ${key}`);
        validate = ajv.compile(schema);
        validators.set(key, validate);
      }

      const body: unknown = await response.json();
      assert.ok(validate(body), `${key}: ${ajv.errorsText(validate.errors)}`);

      return body;
    },
  };
}

if (import.meta.main) {
  await apiContract();
  console.log("OpenAPI definition and response schemas validated");
}
