const { serverContext, installContext } = require("./helpers/server-resolver");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const server = require("../lib/server");

describe("ide-gopls server discovery and installation", () => {
  let directory;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "ide-gopls-resolution-"));
    const sdk = path.join(directory, process.platform === "win32" ? "go.exe" : "go");
    fs.writeFileSync(sdk, "Go SDK fixture");
    fs.chmodSync(sdk, 0o755);
  });
  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("prefers an explicit path over managed and PATH copies", async () => {
    const managed = { binaryPath: process.execPath, version: "0.23.0" };
    expect(
      (await server.resolveServer(serverContext({ managedServer: managed }), process.execPath))
        .command,
    ).toBe(process.execPath);
    expect(
      await server.resolveServer(serverContext({ managedServer: managed, env: { PATH: "" } }), ""),
    ).toEqual({
      command: process.execPath,
      args: [],
      version: "0.23.0",
    });
  });

  it("rejects an invalid explicit path instead of silently changing servers", async () => {
    await expectAsync(
      server.resolveServer(
        serverContext({ managedServer: { binaryPath: process.execPath } }),
        path.join(directory, "missing"),
      ),
    ).toBeRejected();
    await expectAsync(server.resolveServer(serverContext(), directory)).toBeRejectedWithError(
      /must name a file/,
    );
  });

  it("resolves PATH executables and returns null when none is installed", async () => {
    const name = process.platform === "win32" ? "gopls.exe" : "gopls";
    const executable = path.join(directory, name);
    fs.copyFileSync(process.execPath, executable);
    fs.chmodSync(executable, 0o755);
    const launch = await server.resolveServer(
      serverContext({ managedServer: null, env: { PATH: directory, PATHEXT: ".EXE" } }),
      "",
    );
    expect(launch.command.toLowerCase()).toBe(executable.toLowerCase());
    expect(
      await server.resolveServer(serverContext({ managedServer: null, env: { PATH: "" } }), ""),
    ).toBeNull();
  });

  it("selects the Go SDK for child commands without changing the process environment", () => {
    const before = process.env.PATH;
    expect(server.goEnvironment(path.join(directory, "go"), { PATH: "previous" })).toEqual({
      PATH: `${directory}${path.delimiter}previous`,
    });
    expect(server.goEnvironment("")).toEqual({});
    expect(process.env.PATH).toBe(before);
  });

  it("rejects a renamed SDK command that gopls could not select through PATH", () => {
    expect(() => server.goEnvironment(path.join(directory, "go1.27.1"))).toThrowError(/same SDK/);
    expect(() => server.goEnvironment(path.join(directory, "go.exe"))).not.toThrow();
  });

  it("resolves stable tagged versions and rejects prereleases and executable text", () => {
    expect(server.versionTag("v0.23.0")).toBe("v0.23.0");
    expect(server.versionTag("0.23.0")).toBe("v0.23.0");
    for (const value of ["latest", "v0.24.0-pre.1", "0.23.0 && whoami", "../tools"])
      expect(() => server.versionTag(value)).toThrowError(/stable version/);
  });

  it("reads the newest stable tag from the canonical Go module proxy", async () => {
    spyOn(globalThis, "fetch").and.resolveTo({
      ok: true,
      json: async () => ({ Version: "v0.23.0" }),
    });
    expect(await server.latestServerVersion()).toBe("0.23.0");
    expect(fetch).toHaveBeenCalledWith("https://proxy.golang.org/golang.org/x/tools/gopls/@latest");
  });

  it("reports proxy failures and rejects malformed release records", async () => {
    spyOn(globalThis, "fetch").and.resolveTo({ ok: false, status: 503 });
    await expectAsync(server.latestServerVersion()).toBeRejectedWithError(/503/);
    fetch.and.resolveTo({ ok: true, json: async () => ({ Version: "master" }) });
    await expectAsync(server.latestServerVersion()).toBeRejectedWithError(/stable version/);
  });

  it("builds the selected tag inside hub staging and authenticates Go modules", async () => {
    let invocation;
    spyOn(childProcess, "execFile").and.callFake((command, args, options, callback) => {
      invocation = { command, args, options };
      const binary = path.join(directory, process.platform === "win32" ? "gopls.exe" : "gopls");
      fs.copyFileSync(process.execPath, binary);
      fs.chmodSync(binary, 0o755);
      callback(null, "", "");
    });
    const api = { setServerInstallationStatus: jasmine.createSpy("installationStatus") };
    const result = await server.installServer(
      installContext({ storagePath: directory, version: "0.23.0", api }),
      path.join(directory, process.platform === "win32" ? "go.exe" : "go"),
    );
    expect(result.version).toBe("0.23.0");
    expect(invocation.command).toBe(
      path.join(directory, process.platform === "win32" ? "go.exe" : "go"),
    );
    expect(invocation.args).toEqual(["install", "golang.org/x/tools/gopls@v0.23.0"]);
    expect(invocation.options.cwd).toBe(directory);
    expect(invocation.options.env.GOBIN).toBe(directory);
    expect(invocation.options.env.GOSUMDB).toBe("sum.golang.org");
    expect(invocation.options.env.GONOSUMDB).toBe("");
    expect(invocation.options.shell).toBeUndefined();
    expect(api.setServerInstallationStatus).toHaveBeenCalledWith("installing");
  });

  it("preserves Go build failure details for the hub's install notification", async () => {
    spyOn(childProcess, "execFile").and.callFake((_command, _args, _options, callback) =>
      callback(new Error("failed"), "", "Go SDK too old"),
    );
    await expectAsync(
      server.installServer(
        installContext({
          storagePath: directory,
          version: "0.23.0",
          api: { setServerInstallationStatus() {} },
        }),
        path.join(directory, process.platform === "win32" ? "go.exe" : "go"),
      ),
    ).toBeRejectedWithError(/Go SDK too old/);
  });
});

describe("ide-gopls adapter lifecycle and settings", () => {
  let main, adapter, registration, disposed;
  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("ide-gopls")).mainModule;
    disposed = jasmine.createSpy("disposeAdapter");
    registration = main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        return { dispose: disposed };
      },
      reportMissingServer() {},
    });
  });
  afterEach(async () => {
    registration.dispose();
    for (const key of [
      "serverPath",
      "goPath",
      "staticcheck",
      "buildFlags",
      "env",
      "local",
      "gofumpt",
      "features.semanticTokens",
    ])
      lumine.config.unset(`ide-gopls.${key}`);
    await lumine.packages.deactivatePackage("ide-gopls");
  });

  it("registers only Go with the hub and returns its exact edge disposable", () => {
    expect(adapter.id).toBe("ide-gopls");
    expect(adapter.grammarScopes).toEqual(["source.go"]);
    expect(adapter.restartKeyPaths).toEqual(["ide-gopls.serverPath", "ide-gopls.goPath"]);
    registration.dispose();
    expect(disposed).toHaveBeenCalled();
  });

  it("keeps independent service edges and reacquires the current package generation", async () => {
    const another = jasmine.createSpy("anotherEdge");
    const edge = main.consumeIdeClient({
      registerAdapter() {
        return { dispose: another };
      },
    });
    registration.dispose();
    expect(another).not.toHaveBeenCalled();
    edge.dispose();
    expect(another).toHaveBeenCalled();
    await lumine.packages.deactivatePackage("ide-gopls");
    const current = (await lumine.packages.activatePackage("ide-gopls")).mainModule;
    expect(current.provideBackgroundTips().packageName).toBe("ide-gopls");
    main = current;
  });

  it("answers gopls configuration unwrapped and uses the same initialization snapshot", () => {
    lumine.config.set("ide-gopls.buildFlags", ["-tags=integration"]);
    lumine.config.set("ide-gopls.env", { GOOS: "linux", CGO_ENABLED: "0" });
    lumine.config.set("ide-gopls.local", "example.org/project");
    lumine.config.set("ide-gopls.gofumpt", true);
    const settings = adapter.getSettings().gopls;
    expect(settings.buildFlags).toEqual(["-tags=integration"]);
    expect(settings.env).toEqual({ GOOS: "linux", CGO_ENABLED: "0" });
    expect(settings.local).toBe("example.org/project");
    expect(settings.gofumpt).toBe(true);
    expect(settings.gopls).toBeUndefined();
    expect(adapter.getSettings()).toEqual({ gopls: settings });
    expect(adapter.getInitializationOptions()).toEqual(settings);
    expect(adapter.getWorkspaceConfiguration).toBeUndefined();
  });

  it("preserves upstream analyzer defaults and explicitly enables or disables Staticcheck", () => {
    expect(adapter.getSettings().gopls.staticcheck).toBeUndefined();
    expect(adapter.getSettings().gopls.local).toBeUndefined();
    lumine.config.set("ide-gopls.staticcheck", "all");
    expect(adapter.getSettings().gopls.staticcheck).toBe(true);
    lumine.config.set("ide-gopls.staticcheck", "off");
    expect(adapter.getSettings().gopls.staticcheck).toBe(false);
  });

  it("keeps server semantic tokens available for scoped overrides", () => {
    lumine.config.set("ide-gopls.features.semanticTokens", false);
    expect(adapter.getInitializationOptions().semanticTokens).toBe(true);
  });

  it("validates the selected SDK before starting gopls", async () => {
    const currentServer = require("../lib/server");
    spyOn(currentServer, "resolveServer").and.resolveTo({ command: process.execPath, args: [] });
    lumine.config.set("ide-gopls.goPath", path.join(os.tmpdir(), "absent-sdk", "go"));
    await expectAsync(
      adapter.resolveServer(serverContext({ rootPath: os.tmpdir() })),
    ).toBeRejected();
  });

  it("reports an unavailable server through the hub and returns null", async () => {
    const currentServer = require("../lib/server");
    spyOn(currentServer, "resolveServer").and.resolveTo(null);
    const missing = jasmine.createSpy("missing");
    let registered;
    const edge = main.consumeIdeClient({
      registerAdapter(value) {
        registered = value;
        return { dispose() {} };
      },
      reportMissingServer: missing,
    });
    try {
      expect(await registered.resolveServer(serverContext({ rootPath: os.tmpdir() }))).toBeNull();
      const args = missing.calls.mostRecent().args;
      expect(args[0]).toBe("ide-gopls");
      expect(typeof args[1].description).toBe("string");
    } finally {
      edge.dispose();
    }
  });
});
