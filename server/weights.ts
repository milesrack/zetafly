import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import {
  type Collection,
  type Db,
  GridFSBucket,
  MongoRuntimeError,
  type ObjectId,
} from "mongodb";
import type { Profile } from "../shared/contracts.ts";
import {
  DEFAULT_WEIGHTS,
  type inspectWeights,
  weightsMetadata,
} from "./brain/weights.ts";
import { asError } from "./errors.ts";

export type StoredProfile = Profile & {
  ownerId: string;
  fileId: ObjectId;
  bytes: number;
  createdAt: Date;
  extension?: ".npz" | ".zip";
  checkpointFormat?: "brain-npz-v1";
};

function stored(profile: Profile | StoredProfile): StoredProfile {
  if (!("fileId" in profile)) {
    throw new Error("Stored checkpoint required");
  }

  return profile;
}

const execute = promisify(execFile);
const LIMIT = 64 * 1024 ** 2;
export const DEFAULT_PROFILE: Profile = {
  id: "published",
  name: "Default",
  ...weightsMetadata(await readFile(DEFAULT_WEIGHTS)),
};

export class Weights {
  collection: Collection<StoredProfile>;
  bucket: GridFSBucket;
  validating: boolean;
  receiving = new Set<string>();

  constructor(db: Db) {
    this.collection = db.collection("weightProfiles");
    this.bucket = new GridFSBucket(db, { bucketName: "weights" });
    this.validating = false;
  }

  async list(ownerId: string, query: unknown = ""): Promise<Profile[]> {
    if (typeof query !== "string" || query.length > 100) {
      throw Object.assign(
        new Error("Search must be text up to 100 characters"),
        { status: 400 },
      );
    }

    const text = query.trim();
    const pattern = RegExp.escape(text);
    const profiles = await this.collection
      .find(
        {
          ownerId,
          checkpointFormat: "brain-npz-v1",
          ...(text ? { name: { $regex: pattern, $options: "i" } } : {}),
        },
        {
          projection: {
            _id: 0,
            fileId: 0,
            ownerId: 0,
            extension: 0,
            checkpointFormat: 0,
            arithmeticMode: 0,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();

    return new RegExp(pattern, "i").test(DEFAULT_PROFILE.name)
      ? [DEFAULT_PROFILE, ...profiles]
      : profiles;
  }

  async upload(req: Request, ownerId: string) {
    if (this.receiving.has(ownerId) || this.receiving.size >= 4) {
      throw Object.assign(
        new Error("Another upload is in progress; try again shortly"),
        { status: 429 },
      );
    }

    this.receiving.add(ownerId);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 60000);
    let validating = false;
    let directory: string | undefined;
    let storedId: ObjectId | undefined;

    try {
      if (
        (await this.collection.countDocuments({
          ownerId,
          checkpointFormat: "brain-npz-v1",
        })) >= 5
      ) {
        throw Object.assign(
          new Error("Remove an uploaded profile before adding another"),
          { status: 409 },
        );
      }

      const name = decodeURIComponent(req.get("x-filename") ?? "");

      if (!/\.npz$/i.test(name) || name.length > 100) {
        throw new Error("Choose an NPZ weights checkpoint");
      }

      directory = await mkdtemp(join(tmpdir(), "zetafly-upload-"));
      const path = join(directory, "weights.npz");
      let bytes = 0;
      const limit = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;

          callback(
            bytes > LIMIT
              ? Object.assign(new Error("Weights must be smaller than 64 MB"), {
                  status: 413,
                })
              : null,
            chunk,
          );
        },
      });

      await pipeline(req, limit, createWriteStream(path, { mode: 0o600 }), {
        signal: controller.signal,
      });

      clearTimeout(deadline);

      if (this.validating) {
        throw Object.assign(
          new Error("Another upload is being validated; try again shortly"),
          { status: 429 },
        );
      }

      this.validating = validating = true;
      let metadata: Awaited<ReturnType<typeof inspectWeights>>;

      try {
        const result = await execute(
          process.execPath,
          [
            "--max-old-space-size=256",
            "server/brain/weights.ts",
            path,
            "--metadata",
          ],
          {
            timeout: 30000,
            maxBuffer: 4096,
            env: { NODE_ENV: process.env.NODE_ENV ?? "production" },
          },
        );

        metadata = JSON.parse(result.stdout);
      } catch (error) {
        throw new Error(
          asError(error).stderr?.trim() || "Checkpoint validation failed",
        );
      }

      const id = randomUUID();
      const upload = this.bucket.openUploadStream(id, {
        metadata: { ownerId },
      });

      await pipeline(createReadStream(path), upload);
      storedId = upload.id;

      const profile = {
        id,
        ownerId,
        name: name.replace(/[/\\]/g, "").replace(/\.npz$/i, ""),
        ...metadata,
        bytes,
        createdAt: new Date(),
        fileId: storedId,
        extension: ".npz" as const,
        checkpointFormat: "brain-npz-v1" as const,
      };

      await this.collection.insertOne(profile);

      return { id, name: profile.name, ...metadata };
    } catch (value) {
      if (storedId) {
        await this.bucket.delete(storedId).catch(() => {});
      }

      const error = controller.signal.aborted
        ? Object.assign(new Error("Upload timed out; try again"), {
            status: 408,
          })
        : asError(value);

      error.status ??= 400;
      throw error;
    } finally {
      clearTimeout(deadline);

      if (validating) {
        this.validating = false;
      }

      this.receiving.delete(ownerId);

      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }

  async get(ownerId: string, id: string): Promise<Profile | StoredProfile> {
    if (id === "published") {
      return DEFAULT_PROFILE;
    }

    const profile = await this.collection.findOne({ ownerId, id });

    if (!profile) {
      throw Object.assign(new Error("Weight profile not found"), {
        status: 404,
      });
    }

    return profile;
  }

  async materialise(ownerId: string, id: string) {
    const profile = await this.get(ownerId, id);

    if (id === "published") {
      return { profile, path: null, cleanup: async () => {} };
    }

    if (stored(profile).checkpointFormat !== "brain-npz-v1") {
      throw Object.assign(
        new Error(
          "Upload an NPZ checkpoint trained for the supported brain before running it",
        ),
        { status: 400 },
      );
    }

    const directory = await mkdtemp(join(tmpdir(), "zetafly-model-"));
    const path = join(directory, `model${stored(profile).extension ?? ".npz"}`);
    const cleanup = () => rm(directory, { recursive: true, force: true });

    try {
      const hash = createHash("sha256");
      const check = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      });

      await pipeline(
        this.bucket.openDownloadStream(stored(profile).fileId),
        check,
        createWriteStream(path, { mode: 0o600 }),
      );

      if (hash.digest("hex") !== profile.sha256) {
        throw new Error("Stored checkpoint hash mismatch");
      }

      return { profile, path, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  async remove(ownerId: string, id: string) {
    if (id === "published") {
      throw Object.assign(new Error("Default weights cannot be removed"), {
        status: 400,
      });
    }

    const profile = await this.get(ownerId, id);
    const { fileId } = stored(profile);

    try {
      await this.bucket.delete(fileId);
    } catch (error) {
      // GridFS clears leftover chunks before reporting that the file is missing.
      if (
        !(error instanceof MongoRuntimeError) ||
        error.message !== `File not found for id ${fileId}`
      ) {
        throw error;
      }
    }

    await this.collection.deleteOne({ ownerId, id });
  }

  download(profile: Profile | StoredProfile, res: Response) {
    res
      .type("application/octet-stream")
      .attachment(
        profile.id === "published"
          ? "zetafly-default.npz"
          : `${profile.name}${stored(profile).extension ?? ".npz"}`,
      );

    const source =
      profile.id === "published"
        ? createReadStream(DEFAULT_WEIGHTS)
        : this.bucket.openDownloadStream(stored(profile).fileId);

    return pipeline(source, res);
  }
}
