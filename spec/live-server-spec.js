const { serverContext, installContext } = require("./helpers/server-resolver");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { findOnPath } = require("./helpers/server-resolver");
const { LiveLspClient } = require("./helpers/live-lsp-client");
const { createProject } = require("./helpers/project");
const { exerciseServer } = require("./helpers/exercise-server");

const serverPath = process.env.GOPLS_PATH || findOnPath("gopls");
if (process.env.REQUIRE_GOPLS && !serverPath)
  throw new Error("CI requires a real gopls executable.");
const liveSuite = serverPath ? describe : () => {};

liveSuite("ide-gopls real gopls protocol", () => {
  let rootPath, client, edge, timeout;
  beforeAll(() => {
    timeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = timeout;
  });
  beforeEach(async () => {
    jasmine.useRealClock();
    rootPath = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "ide-gopls-live-"));
    const main = (await lumine.packages.activatePackage("ide-gopls")).mainModule;
    lumine.config.set("ide-gopls.serverPath", serverPath);
    if (process.env.GO_PATH) lumine.config.set("ide-gopls.goPath", process.env.GO_PATH);
    edge = main.consumeIde({
      registerAdapter(adapter) {
        client = new LiveLspClient(adapter, rootPath);
        return { dispose() {} };
      },
      reportMissingServer() {},
    });
  });
  afterEach(async () => {
    await client.stop();
    edge.dispose();
    lumine.config.unset("ide-gopls.serverPath");
    lumine.config.unset("ide-gopls.goPath");
    await lumine.packages.deactivatePackage("ide-gopls");
    fs.rmSync(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("serves real diagnostics, intelligence, edits, hints, tokens and advertised hierarchies", async () => {
    const fixture = createProject(rootPath);
    const { capabilities, serverInfo } = await client.start();
    expect(serverInfo.name).toBe("gopls");
    if (process.env.GOPLS_VERSION) expect(serverInfo.version).toContain(process.env.GOPLS_VERSION);
    const covered = await exerciseServer(client, fixture, capabilities);
    expect(covered).toContain("formatting");
    expect(covered).toContain("incoming calls");
    expect(covered).toContain("type subtypes");
  });

  it("builds and launches a managed copy with the configured Go SDK", async () => {
    const fixture = createProject(rootPath);
    const goPath = process.env.GO_PATH || findOnPath("go");
    expect(goPath).toBeTruthy();
    const currentServer = require("../lib/server");
    const storagePath = path.join(rootPath, "managed");
    const installed = await currentServer.installServer(
      installContext({
        storagePath,
        version: process.env.GOPLS_VERSION || "0.23.0",
        api: { setServerInstallationStatus() {} },
      }),
      goPath,
    );
    const launch = await currentServer.resolveServer(
      serverContext({
        managedServer: {
          binaryPath: path.join(storagePath, installed.binary),
          version: installed.version,
        },
      }),
      "",
    );
    expect(launch.command).toBe(path.join(storagePath, installed.binary));
    expect(installed.version).toBe(process.env.GOPLS_VERSION || "0.23.0");
    lumine.config.set("ide-gopls.serverPath", "");
    const { serverInfo } = await client.start({
      binaryPath: launch.command,
      version: installed.version,
    });
    expect(serverInfo.name).toBe("gopls");
    expect(serverInfo.version).toContain(installed.version);
    client.open(fixture.uri, "go", fixture.text);
    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri: fixture.uri },
      options: { tabSize: 4, insertSpaces: false },
    });
    expect(edits.length).toBeGreaterThan(0);
  });
});
