const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const MODULE = "golang.org/x/tools/gopls";
const LATEST_URL = `https://proxy.golang.org/${MODULE}/@latest`;

const resolveServer = async (context, configuredPath = "") => {
  const selection = await context.resolver.select({
    kind: "executable",
    configuredPath,
    managed: () => {
      const installed = context.getManagedServer();
      return installed ? { path: installed.binaryPath, version: installed.version } : null;
    },
    env: context.env,
    cwd: context.rootPath,
    names: ["gopls"],
    signal: context.signal,
  });
  return selection
    ? context.resolver.launch(selection, { signal: context.signal, args: [] })
    : null;
};

const versionTag = (value) => {
  const version = String(value).replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`Unsupported gopls release '${value}'; choose a stable version.`);
  return `v${version}`;
};

// The Go module proxy selects the newest tagged, stable release, unlike the
// tools repository's GitHub releases, which do not publish gopls binaries.
const latestServerVersion = async () => {
  const response = await fetch(LATEST_URL);
  if (!response.ok) throw new Error(`The Go module proxy answered ${response.status}.`);
  const release = await response.json();
  return versionTag(release.Version).slice(1);
};

const goEnvironment = (goPath, env = process.env) => {
  if (!goPath) return {};
  if (!/^go(?:\.exe)?$/i.test(path.basename(goPath)))
    throw new Error(
      "Go Path must name the SDK's go or go.exe executable so gopls uses the same SDK.",
    );
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  return { [pathKey]: `${path.dirname(goPath)}${path.delimiter}${env[pathKey] || ""}` };
};

const installServer = async ({ storagePath, version, api }, configuredGoPath = "") => {
  const selected = await api.resolver.select({
    kind: "executable",
    configuredPath: configuredGoPath,
    names: ["go"],
  });
  const goPath = selected?.path;
  if (!goPath)
    throw new Error("Install the Go SDK and put go on PATH, or set Go Path in ide-gopls settings.");
  goEnvironment(goPath);
  const tag = versionTag(version || (await latestServerVersion()));
  await fs.promises.mkdir(storagePath, { recursive: true });
  api.setServerInstallationStatus("installing");
  await new Promise((resolve, reject) => {
    childProcess.execFile(
      goPath,
      ["install", `${MODULE}@${tag}`],
      {
        cwd: storagePath,
        windowsHide: true,
        timeout: 300000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          ...goEnvironment(goPath),
          GOBIN: storagePath,
          // Authenticate the public upstream module and its dependencies with
          // the official checksum database, including with a custom global
          // Go environment configured for private modules.
          GOPROXY: process.env.GOPROXY || "https://proxy.golang.org",
          GOSUMDB: "sum.golang.org",
          GOPRIVATE: "",
          GONOSUMDB: "",
          GONOPROXY: "",
        },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve();
        reject(
          new Error(`Go could not install gopls ${tag}:\n${stderr || stdout || error.message}`),
        );
      },
    );
  });
  const binary = process.platform === "win32" ? "gopls.exe" : "gopls";
  await fs.promises.access(path.join(storagePath, binary), fs.constants.X_OK);
  return { version: tag.slice(1), binary };
};

module.exports = {
  resolveServer,
  versionTag,
  latestServerVersion,
  goEnvironment,
  installServer,
};
