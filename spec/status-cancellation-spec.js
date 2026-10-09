const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

describe("gopls installer status lifetime", () => {
  it("does not spawn when an installation-status listener cancels its operation", async () => {
    await lumine.packages.activatePackage("ide-gopls");
    const server = require("../lib/server");
    const controller = new AbortController();
    const reason = new Error("cancelled from status listener");
    spyOn(fs.promises, "mkdir").and.resolveTo();
    const spawn = spyOn(childProcess, "execFile").and.callFake(
      (_command, _args, _options, callback) => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          callback(null, "", "");
          child.emit("close", 0);
        });
        return child;
      },
    );
    const api = {
      signal: controller.signal,
      resolver: {
        select: async () => ({
          path: path.join(
            __dirname,
            "controlled-sdk",
            process.platform === "win32" ? "go.exe" : "go",
          ),
        }),
      },
      setServerInstallationStatus() {
        controller.abort(reason);
      },
    };
    await expectAsync(
      server.installServer({
        storagePath: path.join(__dirname, "unused-stage"),
        version: "0.23.0",
        api,
      }),
    ).toBeRejectedWith(reason);
    expect(spawn).not.toHaveBeenCalled();
    await lumine.packages.deactivatePackage("ide-gopls");
  });
});
