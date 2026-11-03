import type { Db, ObjectId } from "mongodb";

export async function deleteAccountData(db: Db, ownerId: string) {
  const profiles = await db
    .collection<{ ownerId: string; fileId: ObjectId }>("weightProfiles")
    .find({ ownerId }, { projection: { fileId: 1 } })
    .toArray();
  const files = await db
    .collection("weights.files")
    .find({ "metadata.ownerId": ownerId }, { projection: { _id: 1 } })
    .toArray();
  const fileIds = [
    ...profiles.map((profile) => profile.fileId),
    ...files.map((file) => file._id),
  ];

  // Retain file/profile references until chunks are removed so retries can finish cleanup.
  await db
    .collection("weights.chunks")
    .deleteMany({ files_id: { $in: fileIds } });
  await db.collection("weights.files").deleteMany({ _id: { $in: fileIds } });

  await db.collection("weightProfiles").deleteMany({ ownerId });
  await db.collection("preferences").deleteMany({ ownerId });
  await db.collection("runs").deleteMany({ ownerId });
  await db.collection("verification").deleteMany({ value: ownerId });
}
