/** The home page's extract of the verification data (generated/home.json, see scripts/generate-home.ts). */
import data from "./generated/home.json";
import type { HomeData } from "./verification-types";

export const HOME = data as HomeData;
