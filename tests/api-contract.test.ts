import assert from "node:assert/strict";
import test from "node:test";
import { apiContract } from "../scripts/api-contract.ts";

const contract = await apiContract();

test("checkpoint search requires an API credential", () => {
  assert.deepEqual(contract.document.paths["/api/weights"]?.get?.security, [
    { bearerAuth: [] },
    { accessCookie: [] },
  ]);
});

test("the API contract rejects response drift and fields that could leak private model data", async () => {
  await contract.response("/api/health", Response.json({ status: "ok" }));

  await contract.response(
    "/api/health",
    Response.json({ status: "unavailable" }, { status: 503 }),
  );

  await assert.rejects(() =>
    contract.response("/api/health", Response.json({ status: "healthy" })),
  );

  await assert.rejects(() =>
    contract.response(
      "/api/weights",
      Response.json([
        {
          id: "model",
          name: "Model",
          features: 512,
          arithmeticMode: "digits",
          synaptic: false,
          sha256: "a".repeat(64),
          ownerId: "private-owner",
        },
      ]),
    ),
  );

  await assert.rejects(() =>
    contract.response(
      "/api/weights",
      Response.json({ error: "Missing" }, { status: 404 }),
    ),
  );
});

test("documentation discovery checks feature routers in nested directories", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "zetafly-routes-"));

  try {
    await mkdir(join(directory, "routes"));
    await writeFile(
      join(directory, "routes", "feature.ts"),
      `
      router.get(
        "/api/undocumented",
        handler,
      );
    `,
    );
    await assert.rejects(
      () => apiContract(directory),
      /Undocumented GET \/api\/undocumented/,
    );
    await writeFile(
      join(directory, "routes", "feature.ts"),
      `router.get("/api/runs/:id", handler);`,
    );
    await apiContract(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
