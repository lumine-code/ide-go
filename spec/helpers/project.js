const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const source = `package demo

// Adder describes a value that adds a number.
type Adder interface { Add(value int) int }

type Calculator struct {}

func (Calculator) Add(value int) int { return value + 1 }

// Double returns twice its input.
func Double(value int) int { return value * 2 }

func Use() int {
    result := Double(3)
    var adder Adder = Calculator{}
    return adder.Add(result)
}

func Broken() { missingName() }
`;

const position = (text, fragment, inside = 0) => {
  const index = text.indexOf(fragment);
  if (index < 0) throw new Error(`Fixture has no '${fragment}'.`);
  const before = text.slice(0, index + inside).split("\n");
  return { line: before.length - 1, character: before.at(-1).length };
};

const createProject = (rootPath) => {
  fs.mkdirSync(rootPath, { recursive: true });
  fs.writeFileSync(path.join(rootPath, "go.mod"), "module example.org/lumine-spec\n\ngo 1.26\n");
  const filePath = path.join(rootPath, "main.go");
  fs.writeFileSync(filePath, source);
  const testPath = path.join(rootPath, "main_test.go");
  fs.writeFileSync(
    testPath,
    'package demo\n\nimport "testing"\n\nfunc TestDouble(t *testing.T) { if Double(3) != 6 { t.Fatal("unexpected result") } }\n',
  );
  return {
    rootPath,
    filePath,
    uri: pathToFileURL(filePath).href,
    testUri: pathToFileURL(testPath).href,
    text: source,
  };
};

module.exports = { source, position, createProject };
