const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const { installContext } = require("./helpers/server-resolver");

describe("Go installation lifetime", () => {
  let directory;
  beforeEach(() => {
    jasmine.useRealClock();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "ide-go-lifetime-"));
    const sdk = path.join(directory, process.platform === "win32" ? "go.exe" : "go");
    fs.copyFileSync(process.execPath, sdk);
    fs.chmodSync(sdk, 0o755);
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("cancels a module-proxy request rather than leaving its fetch active", async () => {
    const server = require("../lib/server");
    const controller = new AbortController();
    const reason = new DOMException("Installation canceled", "AbortError");
    let finish;
    spyOn(globalThis, "fetch").and.callFake(
      (_url, options = {}) =>
        new Promise((resolve, reject) => {
          finish = () => resolve({ ok: true, json: async () => ({ Version: "v0.23.0" }) });
          options.signal?.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        }),
    );
    const pending = server.latestServerVersion({ signal: controller.signal });
    const outcome = pending.catch((error) => error);
    controller.abort(reason);
    finish();
    expect(await outcome).toBe(reason);
  });

  it("rejects expiry while reading the proxy response body", async () => {
    const server = require("../lib/server");
    const controller = new AbortController();
    const reason = new DOMException("Installation canceled", "AbortError");
    let entered, finish;
    const started = new Promise((resolve) => (entered = resolve));
    spyOn(globalThis, "fetch").and.resolveTo({
      ok: true,
      json: () => {
        entered();
        return new Promise((resolve) => (finish = resolve));
      },
    });
    const pending = server.latestServerVersion({ signal: controller.signal });
    const outcome = pending.catch((error) => error);
    await started;
    controller.abort(reason);
    finish({ Version: "v0.23.0" });
    expect(await outcome).toBe(reason);
  });

  it("keeps the build worker pending until the canceled child has closed", async () => {
    const server = require("../lib/server");
    const controller = new AbortController();
    const reason = new DOMException("Installation canceled", "AbortError");
    const child = new EventEmitter();
    child.kill = jasmine.createSpy("cancel Go child");
    let entered, complete;
    let callbackCalled = false;
    const started = new Promise((resolve) => (entered = resolve));
    spyOn(childProcess, "execFile").and.callFake((_command, _args, options, callback) => {
      complete = () => {
        callbackCalled = true;
        callback(reason, "", "");
      };
      options.signal?.addEventListener(
        "abort",
        () => {
          child.kill();
          complete();
        },
        { once: true },
      );
      entered();
      return child;
    });
    const pending = server.installServer(
      installContext({
        storagePath: directory,
        version: "0.23.0",
        signal: controller.signal,
        api: { setServerInstallationStatus() {} },
      }),
      path.join(directory, process.platform === "win32" ? "go.exe" : "go"),
    );
    let settled = false;
    const outcome = pending.then(
      (value) => {
        settled = true;
        return value;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    await started;
    controller.abort(reason);
    for (let tick = 0; tick < 20; tick++) await Promise.resolve();
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    if (!callbackCalled) complete();
    child.emit("close", 1, "SIGTERM");
    expect(await outcome).toBe(reason);
  });

  it("never fetches or spawns after its installation signal has already expired", async () => {
    const server = require("../lib/server");
    const controller = new AbortController();
    const reason = new DOMException("Installation canceled", "AbortError");
    controller.abort(reason);
    spyOn(globalThis, "fetch");
    spyOn(childProcess, "execFile");
    await expectAsync(server.latestServerVersion({ signal: controller.signal })).toBeRejectedWith(
      reason,
    );
    await expectAsync(
      server.installServer(
        installContext({
          storagePath: directory,
          version: "0.23.0",
          signal: controller.signal,
          api: { setServerInstallationStatus() {} },
        }),
        path.join(directory, process.platform === "win32" ? "go.exe" : "go"),
      ),
    ).toBeRejectedWith(reason);
    expect(fetch).not.toHaveBeenCalled();
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("waits for a real canceled build process to release staging", async () => {
    const server = require("../lib/server");
    const node = require("./helpers/server-resolver").findOnPath("node");
    expect(node).not.toBeNull();
    const sdk = path.join(directory, process.platform === "win32" ? "go.exe" : "go");
    fs.copyFileSync(node, sdk);
    fs.chmodSync(sdk, 0o755);
    const marker = path.join(directory, "started.json");
    fs.writeFileSync(
      path.join(directory, "install"),
      "require('node:fs').writeFileSync('started.json', JSON.stringify({pid:process.pid})); setInterval(() => {}, 1000);",
    );
    const spawn = spyOn(childProcess, "execFile").and.callThrough();
    const controller = new AbortController();
    const reason = new DOMException("Installation canceled", "AbortError");
    const pending = server.installServer(
      installContext({
        storagePath: directory,
        version: "0.23.0",
        signal: controller.signal,
        api: { setServerInstallationStatus() {} },
      }),
      sdk,
    );
    const outcome = pending.catch((error) => error);
    try {
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(marker) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(fs.existsSync(marker)).toBe(true);
      controller.abort(reason);
      expect(await outcome).toBe(reason);
      const child = spawn.calls.mostRecent().returnValue;
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      // Successful immediate removal also checks that Windows no longer has
      // the build's working directory open when the worker rejects.
      fs.rmSync(directory, { recursive: true, force: true });
    } finally {
      controller.abort(reason);
      const child = spawn.calls.mostRecent()?.returnValue;
      if (child && child.exitCode === null && child.signalCode === null) {
        const closed = new Promise((resolve) => child.once("close", resolve));
        child.kill("SIGKILL");
        await closed;
      }
      await outcome;
    }
  }, 15000);
});
