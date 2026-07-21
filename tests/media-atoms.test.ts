import { describe, expect, it } from "vitest";

import { scanMp4Buffer } from "../lib/media";

function atom(type: string, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function ftyp(): Buffer {
  return atom(
    "ftyp",
    Buffer.concat([
      Buffer.from("isom", "latin1"),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from("isommp42", "latin1"),
    ]),
  );
}

describe("read-only MP4 atom inspection", () => {
  it("recognises moov-before-mdat fast-start files", async () => {
    const result = await scanMp4Buffer(Buffer.concat([ftyp(), atom("moov"), atom("mdat", Buffer.alloc(12))]));
    expect(result.valid).toBe(true);
    expect(result.webOptimized).toBe(true);
    expect(result.fragmented).toBe(false);
    expect(result.majorBrand).toBe("isom");
  });

  it("recognises a valid moov-at-end file", async () => {
    const result = await scanMp4Buffer(Buffer.concat([ftyp(), atom("mdat", Buffer.alloc(12)), atom("moov")]));
    expect(result.valid).toBe(true);
    expect(result.webOptimized).toBe(false);
  });

  it("rejects atoms that extend beyond EOF", async () => {
    const broken = Buffer.alloc(12);
    broken.writeUInt32BE(100, 0);
    broken.write("ftyp", 4, 4, "latin1");
    const result = await scanMp4Buffer(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/beyond the end/);
  });

  it("flags fragmented MP4", async () => {
    const result = await scanMp4Buffer(
      Buffer.concat([ftyp(), atom("moov"), atom("moof"), atom("mdat", Buffer.alloc(4))]),
    );
    expect(result.fragmented).toBe(true);
  });
});
