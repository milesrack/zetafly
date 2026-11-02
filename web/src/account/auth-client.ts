import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};
