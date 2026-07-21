import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

declare const trustedMediaPathBrand: unique symbol;

/**
 * An absolute path proven to be contained by an application-owned storage root.
 * Only this module can create values of this type.
 */
export type TrustedMediaPath = string & {
  readonly [trustedMediaPathBrand]: "TrustedMediaPath";
};

export class UnsafeMediaPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeMediaPathError";
  }
}

function normaliseForComparison(value: string): string {
  const normalised = path.resolve(value);
  return process.platform === "win32" ? normalised.toLocaleLowerCase("en-US") : normalised;
}

function assertContained(root: string, candidate: string): string {
  if (/[\0\r\n]/.test(root) || /[\0\r\n]/.test(candidate)) {
    throw new UnsafeMediaPathError("Media paths cannot contain NUL or newline bytes.");
  }

  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  const comparisonRoot = normaliseForComparison(absoluteRoot);
  const comparisonCandidate = normaliseForComparison(absoluteCandidate);
  const relative = path.relative(comparisonRoot, comparisonCandidate);

  if (
    comparisonCandidate === comparisonRoot ||
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UnsafeMediaPathError("Media path must be a file below the configured storage root.");
  }

  return absoluteCandidate;
}

/**
 * Performs a lexical containment check. Use for a not-yet-created output after
 * the application has already secured the storage root and parent directory.
 */
export function trustedPathWithin(root: string, candidate: string): TrustedMediaPath {
  return assertContained(root, candidate) as TrustedMediaPath;
}

/** Performs containment, regular-file, and symlink checks for an existing input. */
export async function trustedExistingMediaPath(
  root: string,
  candidate: string,
): Promise<TrustedMediaPath> {
  const lexicalCandidate = assertContained(root, candidate);
  const [realRoot, realCandidate, stat] = await Promise.all([
    realpath(root),
    realpath(lexicalCandidate),
    lstat(lexicalCandidate),
  ]);

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new UnsafeMediaPathError("Media input must be a regular, non-symbolic-link file.");
  }

  return assertContained(realRoot, realCandidate) as TrustedMediaPath;
}
