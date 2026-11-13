import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import { decode as decodeJpeg } from "jpeg-js";

export const PARENT_PIN_PATTERN = /^\d{6}$/;
export const PARENT_UNLOCK_COOKIE_NAME = "elfplanner_parent_unlock";
const IMAGE_DATA_URL_MAX = 700_000;
const IMAGE_BYTES_MAX = 520_000;

export function clearParentUnlockCookie(res: Pick<Response, "clearCookie">) {
  res.clearCookie(PARENT_UNLOCK_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });
}

export function hashParentPin(pin: string) {
  if (!PARENT_PIN_PATTERN.test(pin)) throw new Error("Use exactly six digits for the grown-up PIN.");
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyParentPin(pin: string, storedHash: string) {
  if (!PARENT_PIN_PATTERN.test(pin)) return false;
  const [saltHex, hashHex, extra] = storedHash.split(":");
  if (extra !== undefined || !/^[a-f0-9]{32}$/.test(saltHex ?? "") || !/^[a-f0-9]{128}$/.test(hashHex ?? "")) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export function validateRewardImageData(imageData: string | null) {
  if (!imageData) return { imageData: null, imageMime: null };
  if (imageData.length > IMAGE_DATA_URL_MAX) throw new Error("That image is too large. Choose a smaller picture and try again.");

  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageData);
  if (!match) throw new Error("Choose the picture using the planner upload control so it can be safely converted to JPEG.");

  const encoded = match[1];
  const bytes = Buffer.from(encoded, "base64");
  const normalizedInput = encoded.replace(/=+$/, "");
  const normalizedOutput = bytes.toString("base64").replace(/=+$/, "");
  if (!bytes.length || normalizedInput !== normalizedOutput) throw new Error("That image is not valid base64 data.");
  if (bytes.length > IMAGE_BYTES_MAX) throw new Error("Please choose an image under 520 KB after compression.");

  let decoded: { width: number; height: number };
  try {
    decoded = decodeJpeg(bytes, {
      useTArray: true,
      tolerantDecoding: false,
      maxResolutionInMP: 1,
      maxMemoryUsageInMB: 16,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("maxResolutionInMP") || reason.includes("maxMemoryUsageInMB")) {
      throw new Error("That picture is too large to store. Choose a smaller image and try again.");
    }
    throw new Error("That JPEG is incomplete or damaged. Choose a valid image and try again.");
  }

  if (!decoded.width || !decoded.height || decoded.width > 720 || decoded.height > 720) {
    throw new Error("That picture is not compressed to 720 pixels or less. Choose it again using the planner upload control.");
  }
  return { imageData, imageMime: "image/jpeg" };
}
