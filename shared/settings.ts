import type { Settings } from "./contracts.ts";

export const ZETAMAC_SETTINGS: Readonly<Settings> = Object.freeze({
  add: true,
  sub: true,
  mul: true,
  div: true,
  add_left_min: 2,
  add_left_max: 100,
  add_right_min: 2,
  add_right_max: 100,
  mul_left_min: 2,
  mul_left_max: 12,
  mul_right_min: 2,
  mul_right_max: 100,
  duration: 120,
  profileId: "published",
});

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  ...ZETAMAC_SETTINGS,
  add_left_max: 100,
  add_right_max: 100,
  mul_left_max: 100,
  mul_right_max: 100,
});
