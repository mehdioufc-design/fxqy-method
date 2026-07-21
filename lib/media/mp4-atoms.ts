import { open } from "node:fs/promises";

import type { TrustedMediaPath } from "./trusted-path";

const MAX_TOP_LEVEL_BOXES = 10_000;
const HEADER_BYTES = 16;

export interface Mp4TopLevelAtom {
  readonly type: string;
  readonly offset: number;
  readonly size: number;
  readonly headerSize: 8 | 16;
}

export interface Mp4AtomScan {
  readonly valid: boolean;
  readonly isIsoBmff: boolean;
  readonly webOptimized: boolean | null;
  readonly fragmented: boolean | null;
  readonly atoms: readonly Mp4TopLevelAtom[];
  readonly majorBrand?: string;
  readonly compatibleBrands: readonly string[];
  readonly errors: readonly string[];
}

interface RandomAccessReader {
  readonly size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

function atomType(buffer: Buffer, offset: number): string {
  return buffer.subarray(offset, offset + 4).toString("latin1");
}

function isPlausibleAtomType(type: string): boolean {
  return type.length === 4 && [...type].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e;
  });
}

async function scanReader(reader: RandomAccessReader): Promise<Mp4AtomScan> {
  const atoms: Mp4TopLevelAtom[] = [];
  const errors: string[] = [];
  let offset = 0;

  while (offset < reader.size && atoms.length < MAX_TOP_LEVEL_BOXES) {
    const remaining = reader.size - offset;
    if (remaining < 8) {
      errors.push(`Trailing ${remaining} bytes cannot form an MP4 atom header.`);
      break;
    }

    const header = await reader.read(offset, Math.min(HEADER_BYTES, remaining));
    if (header.length < 8) {
      errors.push("Could not read a complete MP4 atom header.");
      break;
    }

    const size32 = header.readUInt32BE(0);
    const type = atomType(header, 4);
    if (!isPlausibleAtomType(type)) {
      errors.push(`Invalid atom type at byte ${offset}.`);
      break;
    }

    let headerSize: 8 | 16 = 8;
    let size: number;
    if (size32 === 1) {
      if (header.length < 16) {
        errors.push(`Truncated extended-size atom ${type} at byte ${offset}.`);
        break;
      }
      headerSize = 16;
      const extendedSize = header.readBigUInt64BE(8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        errors.push(`Atom ${type} is too large for safe local inspection.`);
        break;
      }
      size = Number(extendedSize);
    } else if (size32 === 0) {
      size = remaining;
    } else {
      size = size32;
    }

    if (size < headerSize) {
      errors.push(`Atom ${type} has an invalid size (${size}).`);
      break;
    }
    if (size > remaining) {
      errors.push(`Atom ${type} extends beyond the end of the file.`);
      break;
    }

    atoms.push({ type, offset, size, headerSize });
    offset += size;
  }

  if (atoms.length === MAX_TOP_LEVEL_BOXES && offset < reader.size) {
    errors.push("MP4 contains too many top-level atoms.");
  }

  const ftyp = atoms.find((atom) => atom.type === "ftyp");
  let majorBrand: string | undefined;
  const compatibleBrands: string[] = [];
  if (ftyp && ftyp.size >= ftyp.headerSize + 8) {
    const payloadLength = Math.min(ftyp.size - ftyp.headerSize, 4_096);
    const payload = await reader.read(ftyp.offset + ftyp.headerSize, payloadLength);
    if (payload.length >= 8) {
      majorBrand = atomType(payload, 0);
      for (let brandOffset = 8; brandOffset + 4 <= payload.length; brandOffset += 4) {
        compatibleBrands.push(atomType(payload, brandOffset));
      }
    }
  }

  const moov = atoms.find((atom) => atom.type === "moov");
  const mdat = atoms.find((atom) => atom.type === "mdat");
  const fragmented = atoms.some((atom) => atom.type === "moof");
  const isIsoBmff = Boolean(ftyp || moov || mdat);
  const webOptimized = moov && mdat ? moov.offset < mdat.offset : null;

  return {
    valid: errors.length === 0 && isIsoBmff && Boolean(moov) && Boolean(mdat),
    isIsoBmff,
    webOptimized,
    fragmented: isIsoBmff ? fragmented : null,
    atoms,
    majorBrand,
    compatibleBrands,
    errors,
  };
}

export async function scanMp4Atoms(filePath: TrustedMediaPath): Promise<Mp4AtomScan> {
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    return await scanReader({
      size: stat.size,
      async read(offset, length) {
        const buffer = Buffer.allocUnsafe(length);
        const result = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, result.bytesRead);
      },
    });
  } finally {
    await handle.close();
  }
}

/** Pure buffer variant used by diagnostics and unit tests. */
export async function scanMp4Buffer(buffer: Buffer): Promise<Mp4AtomScan> {
  return scanReader({
    size: buffer.length,
    async read(offset, length) {
      return buffer.subarray(offset, Math.min(buffer.length, offset + length));
    },
  });
}

