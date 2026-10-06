const server = require("./server");

const setting = (key) => lumine.config.get(`ide-gopls.${key}`);
const options = () => {
  const staticcheck = setting("staticcheck");
  return {
    env: setting("env") || {},
    buildFlags: setting("buildFlags") || [],
    directoryFilters: setting("directoryFilters") || ["-**/node_modules"],
    gofumpt: setting("gofumpt"),
    staticcheck: staticcheck === "default" ? undefined : staticcheck === "all",
    local: setting("local") || undefined,
    hints: setting("hints") || {},
    completeUnimported: setting("completeUnimported"),
    usePlaceholders: setting("usePlaceholders"),
    codelenses: { test: setting("testCodeLens") },
    // Always advertise semantic tokens. The client's grammar-scoped feature
    // switch governs requests, including a scoped true over a false base.
    semanticTokens: true,
  };
};

module.exports = {
  consumeIdeClient(service) {
    return service.registerAdapter({
      id: "ide-gopls",
      displayName: "Go Language Server",
      grammarScopes: ["source.go"],
      languageId: "go",
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-gopls"],
      restartKeyPaths: ["ide-gopls.serverPath", "ide-gopls.goPath"],
      latestServerVersion: server.latestServerVersion,
      installServer: (context) => server.installServer(context, setting("goPath")),
      async resolveServer(context) {
        const launch = await server.resolveServer(context, setting("serverPath"));
        if (!launch) {
          service.reportMissingServer("ide-gopls", {
            description:
              "Install [gopls](https://go.dev/gopls/) with the Go SDK, or use Manage Servers to install it. Set Server Path when it is outside PATH.",
          });
          return null;
        }
        const goPath = setting("goPath");
        const selectedGo = goPath
          ? await context.resolver.validateFile(goPath, {
              kind: "executable",
              label: "Go Path",
              signal: context.signal,
            })
          : "";
        return {
          ...launch,
          cwd: context.rootPath,
          env: server.goEnvironment(selectedGo),
          transport: "stdio",
        };
      },
      getInitializationOptions: options,
      getSettings: () => ({ gopls: options() }),
    });
  },

  provideBackgroundTips() {
    return {
      packageName: "ide-gopls",
      tips: [
        "Use ide-gopls with the Go SDK to find references, rename symbols and organize imports across a Go module.",
      ],
    };
  },
};
