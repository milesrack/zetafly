import type { Db } from "mongodb";
import type {
  SessionPacket,
  SessionState,
  Settings,
} from "../shared/contracts.ts";
import { Session } from "./session.ts";
import type { Weights } from "./weights.ts";

type CurrentSession = {
  ownerId: string;
  session: Session;
  profileId: string | null;
  cleanup?: () => Promise<void>;
};

type OwnerBroadcast = (ownerId: string, packet: SessionPacket) => void;

// Share one browser and brain worker across accounts.
export class SessionManager {
  declare db: Db;
  declare broadcast: OwnerBroadcast;
  declare weights: Weights;
  declare current: CurrentSession | null;
  declare claiming: boolean;

  constructor(db: Db, broadcast: OwnerBroadcast, weights: Weights) {
    Object.assign(this, { db, broadcast, weights });
    this.current = null;
    this.claiming = false;
  }

  state(ownerId: string): SessionState {
    return this.current?.ownerId === ownerId
      ? this.current.session.state
      : {
          status: "idle",
          keys: [],
          frame: null,
          trial: null,
          attempts: 0,
          accepted: 0,
        };
  }

  async claim(ownerId: string) {
    if (this.claiming) {
      throw Object.assign(
        new Error("The computer is preparing another session"),
        { status: 409 },
      );
    }

    if (this.current?.ownerId === ownerId) {
      return this.current.session;
    }

    if (
      this.current &&
      (this.current.session.running || this.current.session.previewing)
    ) {
      throw Object.assign(
        new Error(
          "Another user is running the fly; try again when their run finishes",
        ),
        { status: 409 },
      );
    }

    this.claiming = true;

    try {
      if (this.current) {
        await this.current.session.close();
        await this.current.cleanup?.();
      }

      const session = new Session(
        this.db,
        (packet) => this.broadcast(ownerId, packet),
        ownerId,
      );

      this.current = { ownerId, session, profileId: null };

      return session;
    } finally {
      this.claiming = false;
    }
  }

  async start(ownerId: string, settings: Settings) {
    await this.weights.get(ownerId, settings.profileId);
    const session = await this.claim(ownerId);

    if (session.running || session.previewing) {
      throw Object.assign(new Error("Computer is busy"), { status: 409 });
    }

    // Reserve before asynchronously downloading a profile; concurrent starts must not race.
    session.previewing = true;

    try {
      if (this.current!.profileId !== settings.profileId) {
        const material = await this.weights.materialise(
          ownerId,
          settings.profileId,
        );

        await session.setProfile(material.profile, material.path);
        await this.current!.cleanup?.();
        this.current!.cleanup = material.cleanup;
        this.current!.profileId = settings.profileId;
      }
    } finally {
      session.previewing = false;
    }

    session.start(settings);
  }

  async stop(ownerId: string) {
    if (this.current?.ownerId === ownerId) {
      await this.current.session.stop();
    }
  }

  async close() {
    if (this.current) {
      await this.current.session.close();
      await this.current.cleanup?.();
    }
  }

  async remove(ownerId: string) {
    if (this.claiming) {
      throw Object.assign(new Error("The computer is preparing; try again"), {
        status: 409,
      });
    }

    if (this.current?.ownerId !== ownerId) {
      return;
    }

    this.claiming = true;

    try {
      await this.current.session.close();
      await this.current.cleanup?.();
      this.current = null;
    } finally {
      this.claiming = false;
    }
  }
}
