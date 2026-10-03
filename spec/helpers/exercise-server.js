const assert = require("node:assert/strict");
const { position } = require("./project");

const requestAt = (client, fixture, method, fragment, inside = 0, extra = {}) =>
  client.request(method, {
    textDocument: { uri: fixture.uri },
    position: position(fixture.text, fragment, inside),
    ...extra,
  });

// Shared by Jasmine and the standalone development probe. Every assertion is
// about an actual server reply; capabilities alone do not demonstrate routing.
const exerciseServer = async (client, fixture, capabilities) => {
  const results = [];
  const check = (name, condition) => {
    assert.ok(condition, `${name} produced no usable result`);
    results.push(name);
  };
  client.open(fixture.uri, "go", fixture.text);
  const diagnostics = await client.waitFor(
    () =>
      client
        .messages("textDocument/publishDiagnostics")
        .find(
          ({ params }) =>
            params.uri === fixture.uri &&
            params.diagnostics.some(({ message }) => message.includes("missingName")),
        )?.params.diagnostics,
    "undefined-name diagnostics",
    90000,
  );
  check(
    "diagnostics",
    diagnostics.some(({ message }) => message.includes("missingName")),
  );

  const completions = await requestAt(client, fixture, "textDocument/completion", "Double(3)", 3);
  check(
    "completion",
    (completions.items || completions).some(({ label }) => label.includes("Double")),
  );
  const hover = await requestAt(client, fixture, "textDocument/hover", "Double(3)", 1);
  check("hover", JSON.stringify(hover).includes("Double"));
  const signature = await requestAt(client, fixture, "textDocument/signatureHelp", "Double(3)", 7);
  check(
    "signature",
    signature.signatures.some(({ label }) => label.includes("value int")),
  );
  const definitions = await requestAt(client, fixture, "textDocument/definition", "Double(3)", 1);
  check(
    "definition",
    definitions.some((item) => (item.uri || item.targetUri) === fixture.uri),
  );
  const references = await requestAt(
    client,
    fixture,
    "textDocument/references",
    "Double(value",
    1,
    { context: { includeDeclaration: true } },
  );
  check("references", references.length >= 2);
  const rename = await requestAt(client, fixture, "textDocument/rename", "Double(3)", 1, {
    newName: "Twice",
  });
  const renameEdits = [
    ...Object.values(rename.changes || {}).flat(),
    ...(rename.documentChanges || []).flatMap((item) => item.edits || []),
  ];
  check("rename", renameEdits.filter(({ newText }) => newText === "Twice").length >= 2);
  const symbols = await client.request("textDocument/documentSymbol", {
    textDocument: { uri: fixture.uri },
  });
  check(
    "document symbols",
    symbols.some(({ name }) => name === "Double"),
  );
  const workspaceSymbols = await client.request("workspace/symbol", { query: "Double" });
  check(
    "workspace symbols",
    workspaceSymbols.some(({ name }) => name.includes("Double")),
  );
  const edits = await client.request("textDocument/formatting", {
    textDocument: { uri: fixture.uri },
    options: { tabSize: 4, insertSpaces: false },
  });
  check("formatting", edits.length > 0);
  const actions = await client.request("textDocument/codeAction", {
    textDocument: { uri: fixture.uri },
    range: diagnostics.find(({ message }) => message.includes("missingName")).range,
    context: { diagnostics, only: ["quickfix", "source.organizeImports"] },
  });
  check("code actions", actions.length > 0);
  const hints = await client.request("textDocument/inlayHint", {
    textDocument: { uri: fixture.uri },
    range: {
      start: { line: 0, character: 0 },
      end: { line: fixture.text.split("\n").length - 1, character: 0 },
    },
  });
  check("inlay hints", hints.length > 0);
  const tokens = await client.request("textDocument/semanticTokens/full", {
    textDocument: { uri: fixture.uri },
  });
  check("semantic tokens", tokens.data.length > 0 && tokens.data.length % 5 === 0);

  client.open(
    fixture.testUri,
    "go",
    require("node:fs").readFileSync(require("node:url").fileURLToPath(fixture.testUri), "utf8"),
  );
  const lenses = await client.request("textDocument/codeLens", {
    textDocument: { uri: fixture.testUri },
  });
  check(
    "code lenses",
    lenses.some(({ command }) => command?.command === "gopls.run_tests"),
  );

  if (capabilities.callHierarchyProvider) {
    const items = await requestAt(
      client,
      fixture,
      "textDocument/prepareCallHierarchy",
      "Double(value",
      1,
    );
    check(
      "prepare call hierarchy",
      items.some(({ name }) => name.includes("Double")),
    );
    const incoming = await client.request("callHierarchy/incomingCalls", { item: items[0] });
    check(
      "incoming calls",
      incoming.some(({ from }) => from.name.includes("Use")),
    );
    const caller = await requestAt(
      client,
      fixture,
      "textDocument/prepareCallHierarchy",
      "Use()",
      1,
    );
    const outgoing = await client.request("callHierarchy/outgoingCalls", { item: caller[0] });
    check(
      "outgoing calls",
      outgoing.some(({ to }) => to.name.includes("Double")),
    );
  }
  if (capabilities.typeHierarchyProvider) {
    const items = await requestAt(
      client,
      fixture,
      "textDocument/prepareTypeHierarchy",
      "Adder interface",
      1,
    );
    check(
      "prepare type hierarchy",
      items.some(({ name }) => name.includes("Adder")),
    );
    const subtypes = await client.request("typeHierarchy/subtypes", { item: items[0] });
    check(
      "type subtypes",
      subtypes.some(({ name }) => name.includes("Calculator")),
    );
    const concrete = await requestAt(
      client,
      fixture,
      "textDocument/prepareTypeHierarchy",
      "Calculator struct",
      1,
    );
    const supertypes = await client.request("typeHierarchy/supertypes", { item: concrete[0] });
    check(
      "type supertypes",
      supertypes.some(({ name }) => name.includes("Adder")),
    );
  }
  return results;
};

module.exports = { exerciseServer };
