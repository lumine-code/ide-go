# ide-go

Provide Go code intelligence through gopls.

Registers the official [gopls](https://go.dev/gopls/) language server with `ide-client`. Install `language-go` for syntax highlighting and the editor service frontends for the features you want to display.

## Features

- **Code intelligence**: provides completion, hover, signature help and diagnostics across Go modules.
- **Navigation**: finds definitions, references, symbols and call and type hierarchies.
- **Refactoring**: renames symbols and offers code actions, including organizing imports.
- **Formatting**: formats Go documents with gofmt or the optional gofumpt style.
- **Inline information**: supplies inlay hints, code lenses and semantic tokens.
- **Server discovery**: uses Server Path, an editor-managed copy or gopls on PATH, in that order.
- **Managed installation**: builds the latest tagged gopls release with the Go SDK, authenticating modules through the Go checksum database.
- **Project settings**: configures build flags, Go command environment, analysis and import grouping through the settings page.

## Installation

To install `ide-go` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/ide-go`.

Install `ide-client` and `language-go`, then install the [Go SDK](https://go.dev/dl/). The SDK must remain available while gopls runs because the server calls `go list` to load your project. Go Path can select a SDK outside PATH; it must point to that SDK's `go` or `go.exe` executable.

Use `ide-client:manage-servers` to install gopls, or run `go install golang.org/x/tools/gopls@latest` yourself. Managed installation requires the Go SDK and an Internet connection; updating and removing the managed server leave the SDK and separately installed servers intact.

Managed installation respects the standard `GOPROXY` environment variable for a corporate module mirror and retains authentication through `sum.golang.org`.

## Usage

Open the folder containing `go.mod` or `go.work` as a project, then open a Go file. The server discovers module dependencies and shares a process across project roots when its workspace support permits it. Feature switches select which results reach the editor without disabling another grammar's scoped override.

## Services

- `ide-client`: consumed to register and configure the Go language server.
- `background-tips.provider`: provided to background-tips to describe Go navigation and refactoring.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
