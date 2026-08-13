import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class WorkspacePathViolationError extends Error {
  readonly code = "WORKSPACE_PATH_INVALID";

  constructor(message = "Filesystem path is outside the managed workspace") {
    super(message);
    this.name = "WorkspacePathViolationError";
  }
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertLexical(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  if (!isContained(absoluteRoot, absoluteCandidate)) {
    throw new WorkspacePathViolationError();
  }
  return absoluteCandidate;
}

function assertNoLinkInExistingAncestors(root: string, candidate: string): void {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  const rel = relative(absoluteRoot, absoluteCandidate);
  let current = absoluteRoot;

  const rootStat = lstatSync(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new WorkspacePathViolationError("Managed workspace root is not a real directory");
  }

  if (!rel) return;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new WorkspacePathViolationError("Symlink or junction traversal is not allowed");
    }
  }
}

function assertNoLinksToExistingPath(path: string): void {
  let current = resolve(path);
  const existing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new WorkspacePathViolationError();
    current = parent;
  }
  while (true) {
    existing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const entry of existing.reverse()) {
    if (lstatSync(entry).isSymbolicLink()) throw new WorkspacePathViolationError("Symlink or junction traversal is not allowed");
  }
}

export function assertNoExistingLinks(root: string, candidate: string): void {
  assertNoLinkInExistingAncestors(root, candidate);
}

function assertRealContainment(root: string, candidate: string): void {
  const realRoot = realpathSync(resolve(root));
  const realCandidate = realpathSync(resolve(candidate));
  if (!isContained(realRoot, realCandidate)) {
    throw new WorkspacePathViolationError();
  }
}

/** Resolve an absolute path while proving its lexical containment. */
export function resolveContainedPath(root: string, candidate: string): string {
  return assertLexical(root, candidate);
}

/** Reject path syntax that is not a single safe relative reference. */
export function assertSafeRelativeReference(reference: string): string {
  if (!reference || isAbsolute(reference) || /^[a-zA-Z]:[\\/]/.test(reference) || reference.startsWith("/") || reference.startsWith("\\")) {
    throw new WorkspacePathViolationError("Filesystem reference must be relative");
  }
  const segments = reference.split(/[\\/]+/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes(":"))) {
    throw new WorkspacePathViolationError("Filesystem reference contains an unsafe segment");
  }
  return reference;
}

/** Prove an existing file/directory has no link/reparse traversal and is realpath-contained. */
export function assertExistingPathContained(root: string, candidate: string): string {
  const absoluteCandidate = assertLexical(root, candidate);
  assertNoLinkInExistingAncestors(root, absoluteCandidate);
  assertRealContainment(root, absoluteCandidate);
  return absoluteCandidate;
}

/** Prove a new path can be created without traversing an existing link/reparse ancestor. */
export function assertParentContainedForWrite(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = assertLexical(absoluteRoot, candidate);
  if (absoluteCandidate === absoluteRoot) {
    throw new WorkspacePathViolationError("Workspace root is not an owned write target");
  }
  if (!existsSync(absoluteRoot)) {
    assertNoLinksToExistingPath(absoluteRoot);
    return absoluteCandidate;
  }
  let existing = dirname(absoluteCandidate);
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) throw new WorkspacePathViolationError();
    existing = parent;
  }
  assertNoLinkInExistingAncestors(root, existing);
  assertRealContainment(root, existing);
  if (existsSync(absoluteCandidate)) {
    assertExistingPathContained(root, absoluteCandidate);
  }
  return absoluteCandidate;
}
