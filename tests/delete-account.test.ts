import assert from "node:assert/strict";
import test from "node:test";
import { type Db, ObjectId } from "mongodb";
import { deleteAccountData } from "../server/delete-account.ts";

test("interrupted file cleanup retains references and can be retried without touching another owner", async () => {
  const aliceFile = new ObjectId();
  const bobFile = new ObjectId();
  const profiles = [
    { ownerId: "alice", fileId: aliceFile },
    { ownerId: "bob", fileId: bobFile },
  ];
  const files = [
    { _id: aliceFile, metadata: { ownerId: "alice" } },
    { _id: bobFile, metadata: { ownerId: "bob" } },
  ];
  let chunks = [{ files_id: aliceFile }, { files_id: bobFile }];
  const deleted: string[] = [];
  let fail = true;
  const db = {
    collection: (name: string) => {
      if (name === "weightProfiles") {
        return {
          find: ({ ownerId }: { ownerId: string }) => ({
            toArray: async () =>
              profiles.filter((row) => row.ownerId === ownerId),
          }),
          deleteMany: async (filter: unknown) => {
            assert.deepEqual(filter, { ownerId: "alice" });
            profiles.splice(0, 1);
          },
        };
      }

      if (name === "weights.files") {
        return {
          find: () => ({ toArray: async () => files.slice(0, 1) }),
          deleteMany: async ({ _id }: { _id: { $in: ObjectId[] } }) => {
            if (fail) {
              fail = false;
              throw Error("Database interrupted file deletion");
            }

            assert.ok(_id.$in.every((id) => id.equals(aliceFile)));
            files.splice(0, 1);
          },
        };
      }

      if (name === "weights.chunks") {
        return {
          deleteMany: async ({
            files_id,
          }: {
            files_id: { $in: ObjectId[] };
          }) => {
            chunks = chunks.filter(
              (row) => !files_id.$in.some((id) => id.equals(row.files_id)),
            );
          },
        };
      }

      return {
        deleteMany: async (filter: unknown) => {
          assert.deepEqual(
            filter,
            name === "verification" ? { value: "alice" } : { ownerId: "alice" },
          );
          deleted.push(name);
        },
      };
    },
  } as unknown as Db;

  await assert.rejects(deleteAccountData(db, "alice"), /Database interrupted/);
  assert.equal(profiles.length, 2);
  assert.equal(files.length, 2);
  assert.deepEqual(chunks, [{ files_id: bobFile }]);
  assert.deepEqual(deleted, []);

  await deleteAccountData(db, "alice");
  assert.deepEqual(profiles, [{ ownerId: "bob", fileId: bobFile }]);
  assert.deepEqual(files, [{ _id: bobFile, metadata: { ownerId: "bob" } }]);
  assert.deepEqual(chunks, [{ files_id: bobFile }]);
  assert.deepEqual(deleted, ["preferences", "runs", "verification"]);
});
