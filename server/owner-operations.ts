import type { Request, RequestHandler, Response } from "express";

export type OwnerMutation = <P = Record<string, string>>(
  handler: (req: Request<P>, res: Response) => Promise<unknown>,
) => RequestHandler<P>;

// Deletion must wait for uploads and writes already in progress for this owner.
export class OwnerOperations {
  private pending = new Map<string, Promise<void>>();

  async run<T>(ownerId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(ownerId);
    const release = Promise.withResolvers<void>();
    this.pending.set(ownerId, release.promise);

    try {
      await previous;

      return await action();
    } finally {
      release.resolve();

      if (this.pending.get(ownerId) === release.promise) {
        this.pending.delete(ownerId);
      }
    }
  }
}
