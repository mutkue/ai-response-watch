# AI Response Watch

A lightweight VS Code extension that tracks and displays **GitHub Copilot Chat response durations** in the status bar — so you always know how long the last AI response took.

## Features

- **Status bar indicator** — shows the last response time (e.g. `⏱ Copilot: 3.2s`) right in your status bar
- **Response history tooltip** — hover over the indicator to see the last 10 responses with model name and timestamp
- **Slow-response warning** — the indicator turns yellow when a response takes 15 seconds or more
- **Reset command** — clear the history via the command palette or by clicking the status bar item
- **Reliable log polling** — uses file polling instead of `fs.watch`, which is unreliable on WSL and Linux

## Requirements

- VS Code `^1.90.0`
- [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) extension installed and active

> The extension currently targets GitHub Copilot Chat logs. Support for other AI chat extensions may be added in the future.

## Usage

The extension activates automatically on VS Code startup. No configuration needed.

Once active, send any message in the Copilot Chat panel. The status bar will update with the response duration after each reply.

### Status Bar

| Display | Meaning |
|---|---|
| `⏱ Copilot: --` | Waiting for first response |
| `⏱ Copilot: 3.2s` | Last response took 3.2 seconds |
| `⏱ Copilot: 18.0s` *(yellow)* | Last response was slow (≥ 15s) |

Hover the item to see a history of the last 10 responses, including model name and time of request.

### Commands

| Command | Description |
|---|---|
| `AI Response Watch: Reset` | Clears the response history and resets the status bar |

You can also click the status bar item directly to reset.

## How It Works

The extension locates the GitHub Copilot Chat log file for the current VS Code session and polls it every 500 ms for new entries. When a completed chat request is detected, it extracts the model name and duration from the log line and updates the status bar.

It always watches the **most recently modified** exthost log, so it continues to work correctly after window reloads.

## Installation

### From source

```bash
git clone https://github.com/<your-username>/ai-response-watch.git
cd ai-response-watch
npm install
npm run package
```

Then install the generated `.vsix` file:

```
Extensions panel → ··· → Install from VSIX…
```

## License

[MIT](LICENSE)
