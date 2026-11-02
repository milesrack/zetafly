import assert from "node:assert/strict";
import test from "node:test";
import type { Db } from "mongodb";
import { Preferences } from "../server/preferences.ts";
import { DEFAULTS } from "../server/settings.ts";
import type { Weights } from "../server/weights.ts";

const profileId = "00000000-0000-0000-0000-000000000001";

function fixture(settings: Record<string, unknown>, profileExists = true) {
  const documents = new Map([
    ["alice", { ...settings }],
    ["bob", { profileId }],
  ]);
  const db = {
    collection: () => ({
      findOne: async ({ ownerId }: { ownerId: string }) => ({
        settings: documents.get(ownerId),
      }),
      updateOne: async (
        query: { ownerId: string; "settings.profileId"?: string },
        update: {
          $set: {
            settings?: Record<string, unknown>;
            "settings.profileId"?: string;
          };
        },
      ) => {
        const previous = documents.get(query.ownerId);
        if (
          query["settings.profileId"] &&
          previous?.profileId !== query["settings.profileId"]
        ) {
          return;
        }
        documents.set(
          query.ownerId,
          update.$set.settings ?? {
            ...previous,
            profileId: update.$set["settings.profileId"],
          },
        );
      },
    }),
  } as unknown as Db;
  const weights = {
    collection: {
      findOne: async (query: unknown) => {
        assert.deepEqual(query, {
          ownerId: "alice",
          id: profileId,
          checkpointFormat: "sequence-npz-v1",
        });
        return profileExists ? { id: profileId } : null;
      },
    },
    get: async (ownerId: string, id: string) => {
      if (ownerId !== "alice" || id !== profileId || !profileExists) {
        throw Object.assign(new Error("Profile not found"), { status: 404 });
      }
    },
  } as unknown as Weights;
  return { preferences: new Preferences(db, weights), documents };
}

test("preferences recover obsolete fields and missing profiles without losing valid settings", async () => {
  const { preferences } = fixture(
    { duration: 60, profileId, obsolete: true },
    false,
  );
  assert.deepEqual(await preferences.get("alice"), {
    ...DEFAULTS,
    duration: 60,
  });
  const invalid = fixture({ duration: 1 });
  assert.deepEqual(await invalid.preferences.get("alice"), DEFAULTS);
});

test("preferences validate profiles before saving and reset only the matching owner's selection", async () => {
  const { preferences, documents } = fixture({ duration: 120 });
  await preferences.save("alice", { duration: 60, profileId });
  assert.deepEqual(await preferences.get("alice"), {
    ...DEFAULTS,
    duration: 60,
    profileId,
  });
  await preferences.resetProfile("alice", "another-profile");
  assert.equal(documents.get("alice")?.profileId, profileId);
  await preferences.resetProfile("alice", profileId);
  assert.equal(documents.get("alice")?.profileId, "published");
  assert.equal(documents.get("bob")?.profileId, profileId);
  const missing = fixture({ duration: 120 }, false);
  await assert.rejects(
    () => missing.preferences.save("alice", { profileId }),
    /Profile not found/,
  );
  assert.deepEqual(missing.documents.get("alice"), { duration: 120 });
});
