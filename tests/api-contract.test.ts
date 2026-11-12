import assert from "node:assert/strict";
import test from "node:test";
import { apiContract } from "../scripts/api-contract.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";

const contract = await apiContract();

test("the API contract rejects response drift and fields that could leak private model data", async () => {
  await contract.response("/api/health", Response.json({ status: "ok" }));

  await contract.response(
    "/api/health",
    Response.json({ status: "unavailable" }, { status: 503 }),
  );

  await assert.rejects(() =>
    contract.response("/api/health", Response.json({ status: "healthy" })),
  );

  const profile = {
    id: "model",
    name: "Model",
    features: 512,
    synaptic: false,
    sha256: "a".repeat(64),
  };
  await contract.response("/api/weights", Response.json([profile]));

  await assert.rejects(() =>
    contract.response(
      "/api/weights",
      Response.json([
        {
          ...profile,
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

  const run = {
    id: "run-1",
    startedAt: "2026-11-11T12:00:00.000Z",
    finishedAt: "2026-11-11T12:02:00.000Z",
    status: "completed",
    attempts: 10,
    accepted: 8,
    protocol: "model-policy-v3",
    settings: DEFAULT_SETTINGS,
  };

  await contract.response("/api/runs", Response.json([run]));

  await assert.rejects(() =>
    contract.response(
      "/api/runs",
      Response.json([
        {
          ...run,
          ownerId: "private-owner",
        },
      ]),
    ),
  );

  await assert.rejects(() =>
    contract.response(
      "/api/runs",
      Response.json([
        {
          ...run,
          _id: "mongo-internal-id",
        },
      ]),
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
