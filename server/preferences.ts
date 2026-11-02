import type { Collection, Db } from "mongodb";
import type { Settings } from "../shared/contracts.ts";
import { DEFAULTS, parseSettings } from "./settings.ts";
import type { Weights } from "./weights.ts";

type StoredPreferences = {
  ownerId: string;
  settings: Record<string, unknown>;
  updatedAt: Date;
};

export class Preferences {
  private collection: Collection<StoredPreferences>;
  private weights: Weights;

  constructor(db: Db, weights: Weights) {
    this.collection = db.collection<StoredPreferences>("preferences");
    this.weights = weights;
  }

  async get(ownerId: string): Promise<Settings> {
    const previous =
      (await this.collection.findOne({ ownerId }))?.settings ?? {};
    let settings = { ...DEFAULTS };

    try {
      settings = parseSettings(
        Object.fromEntries(
          Object.keys(DEFAULTS)
            .filter((key) => Object.hasOwn(previous, key))
            .map((key) => [key, previous[key]]),
        ),
      );
    } catch {
      settings = { ...DEFAULTS };
    }

    if (settings.profileId !== "published") {
      const profile = await this.weights.collection.findOne({
        ownerId,
        id: settings.profileId,
        checkpointFormat: "sequence-npz-v1",
      });

      if (!profile) {
        settings.profileId = "published";
      }
    }

    return settings;
  }

  async save(ownerId: string, value: unknown): Promise<Settings> {
    const settings = parseSettings(value);
    await this.weights.get(ownerId, settings.profileId);

    await this.collection.updateOne(
      { ownerId },
      { $set: { settings, updatedAt: new Date() } },
      { upsert: true },
    );

    return settings;
  }

  async resetProfile(ownerId: string, profileId: string) {
    await this.collection.updateOne(
      { ownerId, "settings.profileId": profileId },
      { $set: { "settings.profileId": "published" } },
    );
  }
}
