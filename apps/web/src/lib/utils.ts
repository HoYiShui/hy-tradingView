import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Sign } from "./format";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const SIGN_TEXT: Record<Sign, string> = { gain: "text-gain", loss: "text-loss", flat: "text-secondary-foreground" };
