const server = require("./server");

const setting = (key) => lumine.config.get(`ide-go.${key}`);
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
      id: "ide-go",
      displayName: "Go Language Server",
      grammarScopes: ["source.go"],
      languageId: "go",
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-go"],
      restartKeyPaths: ["ide-go.serverPath", "ide-go.goPath"],
      latestServerVersion: server.latestServerVersion,
      installServer: (context) => server.installServer(context, setting("goPath")),
      async resolveServer(context) {
        const launch = await server.resolveServer(setting("serverPath"), context.managedServer);
        if (!launch) {
          service.reportMissingServer("ide-go", {
            description:
              "Install [gopls](https://go.dev/gopls/) with the Go SDK, or use Manage Servers to install it. Set Server Path when it is outside PATH.",
          });
          return null;
        }
        return {
          ...launch,
          cwd: context.rootPath,
          env: server.goEnvironment(setting("goPath")),
          transport: "stdio",
        };
      },
      getInitializationOptions: options,
      getSettings: () => ({ gopls: options() }),
      getWorkspaceConfiguration(section) {
        if (!section) return { gopls: options() };
        return section === "gopls" ? options() : undefined;
      },
    });
  },

  provideBackgroundTips() {
    return {
      packageName: "ide-go",
      tips: [
        "Use ide-go with the Go SDK to find references, rename symbols and organize imports across a Go module.",
      ],
    };
  },
};
