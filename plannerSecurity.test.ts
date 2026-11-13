import { describe, expect, it } from "vitest";
import { encode as encodeJpeg } from "jpeg-js";
import { hashParentPin, validateRewardImageData, verifyParentPin } from "./plannerSecurity";

function tinyJpeg(width = 2, height = 2) {
  return encodeJpeg({
    width,
    height,
    data: Buffer.alloc(width * height * 4, 255),
  }, 80).data;
}

describe("planner security helpers", () => {
  it("verifies a six-digit PIN using a salted hash and rejects wrong codes", () => {
    const stored = hashParentPin("483920");
    expect(stored).not.toContain("483920");
    expect(verifyParentPin("483920", stored)).toBe(true);
    expect(verifyParentPin("483921", stored)).toBe(false);
    expect(verifyParentPin("12", stored)).toBe(false);
  });

  it("accepts a fully decoded normalized JPEG and matches its server MIME", () => {
    const jpeg = tinyJpeg();
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    expect(validateRewardImageData(dataUrl)).toEqual({ imageData: dataUrl, imageMime: "image/jpeg" });
  });

  it("rejects a JPEG signature that does not contain a complete decodable image", () => {
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03]);
    const dataUrl = `data:image/jpeg;base64,${truncated.toString("base64")}`;
    expect(() => validateRewardImageData(dataUrl)).toThrow(/incomplete or damaged/);
  });

  it("rejects oversized output dimensions and uploads not normalized to JPEG", () => {
    const oversized = tinyJpeg(721, 1);
    const oversizedUrl = `data:image/jpeg;base64,${oversized.toString("base64")}`;
    expect(() => validateRewardImageData(oversizedUrl)).toThrow(/720 pixels or less/);
    expect(() => validateRewardImageData("data:image/png;base64,iVBORw0KGgo=" )).toThrow(/converted to JPEG/);
    expect(() => validateRewardImageData("data:image/svg+xml;base64,PHN2Zz4=" )).toThrow(/converted to JPEG/);
  });
});
