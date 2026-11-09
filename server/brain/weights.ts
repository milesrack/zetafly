import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { decodeArchive } from "./arrays.ts";
import { decodeCheckpoint } from "./checkpoint.ts";
import { type BrainGraph, loadGraph, sha256 } from "./graph.ts";
import { Brain } from "./model.ts";

export const DEFAULT_WEIGHTS = "models/default/weights.npz";

export function restoreWeights(graph: BrainGraph, bytes: Uint8Array) {
  return new Brain(graph, decodeCheckpoint(decodeArchive(bytes)));
}

export function weightsMetadata(bytes: Uint8Array) {
  const brain = decodeCheckpoint(decodeArchive(bytes));
  return {
    sha256: sha256(bytes),
    features: brain.nodes[3].length,
    synaptic: true,
  };
}

export async function inspectWeights(bytes: Uint8Array) {
  // Reject malformed arrays before allocating the connectome.
  const metadata = weightsMetadata(bytes);
  restoreWeights(await loadGraph(), bytes);
  return metadata;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (!process.argv[2]?.endsWith(".npz")) {
      throw Error("Provide a brain weights .npz path");
    }

    console.log(
      JSON.stringify(await inspectWeights(await readFile(process.argv[2]))),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
