import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FileMutationCoordinator,
  pathIsWithin,
  remapMutationPath,
  type FileMutationRequest,
} from "@/lib/file-mutation";
import {
  commitWorkspaceFileMutation,
  dynamicTabId,
  initialState,
  openDynamicTab,
} from "@/lib/workspace-sidebar";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const oldPath = "/workspace/docs/notes.md";
const newPath = "/workspace/docs/renamed.md";

function renameRequest(): FileMutationRequest {
  return {
    kind: "rename",
    targetPath: oldPath,
    newPath,
    nodeType: "file",
    baseDir: "/workspace",
  };
}

describe("FileMutationCoordinator race contract", () => {
  it("cancels a pending autosave and resumes writes only on the renamed path", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const writes: string[] = [];
    let path = oldPath;
    let timer = setTimeout(() => writes.push(path), 1000);
    const coordinator = new FileMutationCoordinator(async () => ({}));
    coordinator.registerParticipant({
      id: "editor",
      matches: () => true,
      prepare: () => {
        clearTimeout(timer);
      },
      commit: () => {
        path = newPath;
        timer = setTimeout(() => writes.push(path), 1000);
      },
      rollback: () => {
        timer = setTimeout(() => writes.push(path), 1000);
      },
    });

    t.mock.timers.tick(500);
    await coordinator.run(renameRequest());
    assert.deepEqual(writes, []);
    t.mock.timers.tick(1000);
    assert.deepEqual(writes, [newPath]);
  });

  it("waits for an in-flight save before executing rename", async () => {
    const inFlight = deferred<boolean>();
    const order: string[] = [];
    const files = new Map([[oldPath, "before"]]);
    const coordinator = new FileMutationCoordinator(async () => {
      order.push("rename");
      files.set(newPath, files.get(oldPath)!);
      files.delete(oldPath);
      return {};
    });
    coordinator.registerParticipant({
      id: "editor",
      matches: () => true,
      prepare: async () => {
        order.push("prepare");
        if (!(await inFlight.promise)) throw new Error("save failed");
      },
      commit: () => {
        order.push("commit");
      },
    });

    const running = coordinator.run(renameRequest());
    await Promise.resolve();
    assert.deepEqual(order, ["prepare"]);
    files.set(oldPath, "latest dirty content");
    order.push("save");
    inFlight.resolve(true);
    await running;
    assert.deepEqual(order, ["prepare", "save", "rename", "commit"]);
    assert.equal(files.get(newPath), "latest dirty content");
    assert.equal(files.has(oldPath), false);
  });

  it("deleting a dirty active file cancels every autosave tail and closes owners", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const writes: string[] = [];
    const timer = setTimeout(() => writes.push(oldPath), 1000);
    let previewOpen = true;
    let tabOpen = true;
    const coordinator = new FileMutationCoordinator(async () => ({}));
    coordinator.registerParticipant({
      id: "editor",
      matches: () => true,
      isDirty: () => true,
      prepare: () => clearTimeout(timer),
      commit: () => {
        previewOpen = false;
        tabOpen = false;
      },
    });
    const request: FileMutationRequest = {
      kind: "delete",
      targetPath: oldPath,
      nodeType: "file",
      baseDir: "/workspace",
    };

    assert.equal(coordinator.hasUnsavedChanges(request), true);
    await coordinator.run(request);
    t.mock.timers.tick(2000);
    assert.deepEqual(writes, []);
    assert.equal(previewOpen, false);
    assert.equal(tabOpen, false);
  });

  it("rolls back a failed API operation and resumes autosave on the old path", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const writes: string[] = [];
    let guard = false;
    let timer = setTimeout(() => writes.push(oldPath), 1000);
    const coordinator = new FileMutationCoordinator(async () => {
      throw new Error("already exists");
    });
    coordinator.registerParticipant({
      id: "editor",
      matches: () => true,
      prepare: () => {
        guard = true;
        clearTimeout(timer);
      },
      rollback: () => {
        guard = false;
        timer = setTimeout(() => writes.push(oldPath), 1000);
      },
    });

    await assert.rejects(coordinator.run(renameRequest()), /already exists/);
    assert.equal(guard, false);
    t.mock.timers.tick(1000);
    assert.deepEqual(writes, [oldPath]);
  });

  it("keeps the write guard active until delayed commit acknowledgement resolves", async () => {
    const acknowledgement = deferred<void>();
    let guard = false;
    let attemptedWrites = 0;
    const coordinator = new FileMutationCoordinator(async () => ({}));
    coordinator.registerParticipant({
      id: "editor",
      priority: 10,
      matches: () => true,
      prepare: () => {
        guard = true;
      },
      commit: async () => {
        await acknowledgement.promise;
        guard = false;
      },
    });

    const running = coordinator.run(renameRequest());
    await Promise.resolve();
    await Promise.resolve();
    if (!guard) attemptedWrites += 1;
    assert.equal(guard, true);
    assert.equal(coordinator.isMutationInFlight(), true);
    assert.equal(attemptedWrites, 0);
    acknowledgement.resolve();
    await running;
    assert.equal(guard, false);
    assert.equal(coordinator.isMutationInFlight(), false);
  });

  it("migrates tabs and tree paths without a PreviewPanel and respects path boundaries", async () => {
    let sidebar = openDynamicTab(initialState(), {
      id: dynamicTabId("markdown", "/workspace/foo/a.md"),
      kind: "markdown",
      key: "/workspace/foo/a.md",
      title: "a.md",
      filePath: "/workspace/foo/a.md",
    });
    sidebar = openDynamicTab(sidebar, {
      id: dynamicTabId("markdown", "/workspace/foobar/b.md"),
      kind: "markdown",
      key: "/workspace/foobar/b.md",
      title: "b.md",
      filePath: "/workspace/foobar/b.md",
    });
    const expanded = new Set(["/workspace/foo", "/workspace/foobar"]);
    const coordinator = new FileMutationCoordinator(async () => ({}));
    coordinator.registerParticipant({
      id: "owners-without-preview",
      matches: () => true,
      commit: (transaction) => {
        sidebar = commitWorkspaceFileMutation(sidebar, transaction);
        const next = new Set<string>();
        for (const path of expanded) {
          next.add(
            pathIsWithin(path, transaction.targetPath) && transaction.newPath
              ? remapMutationPath(path, transaction.targetPath, transaction.newPath)
              : path,
          );
        }
        expanded.clear();
        for (const path of next) expanded.add(path);
      },
    });

    await coordinator.run({
      kind: "rename",
      targetPath: "/workspace/foo",
      newPath: "/workspace/baz",
      nodeType: "directory",
      baseDir: "/workspace",
    });
    const paths = sidebar.tabs
      .filter((tab) => tab.kind === "markdown")
      .map((tab) => tab.filePath);
    assert.deepEqual(paths, [
      "/workspace/baz/a.md",
      "/workspace/foobar/b.md",
    ]);
    assert.deepEqual([...expanded], ["/workspace/baz", "/workspace/foobar"]);
  });
});
