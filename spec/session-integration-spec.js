const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProject, position } = require("./helpers/project");
const { findOnPath } = require("./helpers/server-resolver");

const serverPath = process.env.GOPLS_PATH || findOnPath("gopls");
const liveSuite = serverPath ? describe : () => {};
const until = async (check, label) => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out`);
};

liveSuite("ide-gopls real editor routing", () => {
  let rootPath, editor, previousPaths, previousTimeout, service;
  beforeAll(() => {
    previousTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = previousTimeout;
  });
  beforeEach(async () => {
    jasmine.useRealClock();
    previousPaths = lumine.project.getPaths();
    rootPath = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "ide-gopls-sessions-"),
    );
    lumine.config.set("ide-gopls.serverPath", serverPath);
    if (process.env.GO_PATH) lumine.config.set("ide-gopls.goPath", process.env.GO_PATH);
    for (const name of ["language-go", "ide", "ide-gopls"])
      await lumine.packages.activatePackage(name);
    service = lumine.packages.getActivePackage("ide").mainModule.provideIde();
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("ide-gopls");
    await lumine.packages.deactivatePackage("ide");
    await lumine.packages.deactivatePackage("language-go");
    for (const key of ["serverPath", "goPath", "features.format"])
      lumine.config.unset(`ide-gopls.${key}`);
    lumine.project.setPaths(previousPaths);
    await lumine.fileWatchClient.settlePendingTeardown();
    fs.rmSync(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("routes real completion and formatting, honours feature switches and stops on unload", async () => {
    const fixture = createProject(rootPath);
    lumine.project.setPaths([rootPath]);
    editor = await lumine.workspace.open(fixture.filePath);
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.go"));
    const session = await until(
      async () =>
        (await service.activeSessionsForEditor(editor)).find(
          ({ adapter }) => adapter.id === "ide-gopls",
        ),
      "Go session",
    );
    expect(session.state).toBe("running");
    expect(session.supports("textDocument/hover", editor)).toBe(true);
    const clientMain = lumine.packages.getActivePackage("ide").mainModule;
    const point = position(fixture.text, "Double(3)", 3);
    const suggestions = await clientMain.provideAutocomplete().getSuggestions({
      editor,
      bufferPosition: new (require("lumine").Point)(point.line, point.character),
      prefix: "Dou",
      activatedManually: true,
    });
    expect(
      suggestions.some((item) =>
        (item.displayText || item.text || item.snippet || "").includes("Double"),
      ),
    ).toBe(true);
    const provider = clientMain.provideCodeFormatFile();
    const edits = await provider.formatEntireFile(editor);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every((edit) => edit.oldRange && typeof edit.newText === "string")).toBe(true);
    lumine.config.set("ide-gopls.features.format", false);
    expect(await service.activeSessionForFeature(editor, "textDocument/formatting")).toBeNull();
    expect(await provider.formatEntireFile(editor)).toBeNull();
    lumine.config.set("ide-gopls.features.format", true);
    expect(await service.activeSessionForFeature(editor, "textDocument/formatting")).toBe(session);
    await lumine.packages.deactivatePackage("ide-gopls");
    await until(() => session.state === "stopped", "Go package teardown");
    expect(service.adaptersForEditor(editor)).toEqual([]);
  });
});
