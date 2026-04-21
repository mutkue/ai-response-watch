import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Matches lines like:
//   ccreq:5f77c0ca.copilotmd | success | claude-sonnet-4.6 -> claude-sonnet-4-6 | 4818ms | [panel/editAgent]
const LOG_LINE_RE = /ccreq:[a-f0-9]+\.copilotmd \| success \| (.+?) \| (\d+)ms \| \[([^\]]+)\]/;

// Poll every 500 ms — reliable on WSL/Linux where fs.watch is unreliable
const POLL_INTERVAL_MS = 500;

interface RequestStat {
    model: string;
    durationMs: number;
    context: string;
    timestamp: Date;
}

/**
 * Locate the GitHub Copilot Chat log for the current VS Code session.
 * Returns the MOST RECENTLY MODIFIED log across all exthost directories,
 * because VS Code creates a new exthost on every window reload and Copilot
 * Chat may move to a newer exthost while our extension stays in an older one.
 */
function findCopilotChatLog(context: vscode.ExtensionContext): string | undefined {
    try {
        const extHostDir = path.dirname(context.logUri.fsPath);
        const sessionDir = path.dirname(extHostDir);

        let newest: { path: string; mtimeMs: number } | undefined;

        for (const entry of fs.readdirSync(sessionDir)) {
            if (!entry.startsWith('exthost')) { continue; }
            const candidate = path.join(
                sessionDir, entry,
                'GitHub.copilot-chat',
                'GitHub Copilot Chat.log'
            );
            if (!fs.existsSync(candidate)) { continue; }
            const { mtimeMs } = fs.statSync(candidate);
            if (!newest || mtimeMs > newest.mtimeMs) {
                newest = { path: candidate, mtimeMs };
            }
        }

        return newest?.path;
    } catch {
        // session dir may not exist yet on first activation
    }
    return undefined;
}

function shortModel(model: string): string {
    // "claude-sonnet-4.6 -> claude-sonnet-4-6"  →  "claude-sonnet-4.6"
    return model.split('->')[0].trim();
}

export function activate(context: vscode.ExtensionContext): void {
    const out = vscode.window.createOutputChannel('AI Response Watch');
    context.subscriptions.push(out);

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(clock) Copilot: --';
    statusBar.tooltip = 'GitHub Copilot Chat Timer — waiting for first response';
    statusBar.command = 'ai-response-watch.reset';
    statusBar.show();
    context.subscriptions.push(statusBar);

    const history: RequestStat[] = [];

    function updateStatusBar(stat: RequestStat): void {
        history.unshift(stat);
        if (history.length > 10) { history.pop(); }

        const secs = (stat.durationMs / 1000).toFixed(1);
        statusBar.text = `$(clock) Copilot: ${secs}s`;

        const lines = history.map((h, i) => {
            const t = (h.durationMs / 1000).toFixed(1);
            const when = h.timestamp.toLocaleTimeString();
            return `${i === 0 ? '▶' : ' '} ${t}s  ${shortModel(h.model)}  ${when}`;
        });
        const md = new vscode.MarkdownString(
            `**Copilot Chat — last ${history.length} response(s)**\n\n` +
            `\`\`\`\n${lines.join('\n')}\n\`\`\`\n\n_Click to reset_`
        );
        md.isTrusted = true;
        statusBar.tooltip = md;

        if (stat.durationMs >= 15_000) {
            statusBar.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        } else {
            statusBar.color = undefined;
        }
    }

    function processNewBytes(logPath: string, fileOffset: number): number {
        try {
            const stat = fs.statSync(logPath);
            if (stat.size <= fileOffset) {
                return stat.size < fileOffset ? stat.size : fileOffset; // truncated
            }

            const len = stat.size - fileOffset;
            const buf = Buffer.alloc(len);
            const fd = fs.openSync(logPath, 'r');
            fs.readSync(fd, buf, 0, len, fileOffset);
            fs.closeSync(fd);

            const text = buf.toString('utf8');
            for (const line of text.split('\n')) {
                const m = LOG_LINE_RE.exec(line);
                if (!m) { continue; }
                const [, model, durationStr, ctx] = m;

                // Only surface the main chat panel response, not internal tool calls
                if (ctx !== 'panel/editAgent') { continue; }

                out.appendLine(`[${new Date().toLocaleTimeString()}] ${ctx} | ${shortModel(model)} | ${durationStr}ms`);
                updateStatusBar({
                    model,
                    durationMs: parseInt(durationStr, 10),
                    context: ctx,
                    timestamp: new Date(),
                });
            }

            return stat.size;
        } catch {
            return fileOffset;
        }
    }

    // ── locate log file and poll ─────────────────────────────────────────────
    let logPath: string | undefined;
    let fileOffset = 0;
    let retryCount = 0;

    const timer = setInterval(() => {
        const latestLog = findCopilotChatLog(context);

        // Switched to a newer exthost log (e.g. after window reload)
        if (latestLog && latestLog !== logPath) {
            logPath = latestLog;
            fileOffset = fs.statSync(logPath).size; // skip historical entries
            out.appendLine(`Watching: ${logPath}`);
            statusBar.tooltip = `Copilot Chat Timer\nWatching: ${path.basename(path.dirname(logPath))}/${path.basename(logPath)}\n\nNo responses yet — send a chat message.`;
            retryCount = 0;
            return;
        }

        if (!logPath) {
            if (++retryCount > 20) {
                clearInterval(timer);
                statusBar.tooltip = 'Copilot Chat log not found.\nCheck Output › Copilot Chat Timer for details.';
                out.appendLine(`Log not found after retries. Searched in: ${path.dirname(path.dirname(context.logUri.fsPath))}`);
                out.show();
            }
            return;
        }

        fileOffset = processNewBytes(logPath, fileOffset);
    }, POLL_INTERVAL_MS);

    context.subscriptions.push({ dispose: () => clearInterval(timer) });

    // ── reset command ────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-response-watch.reset', () => {
            history.length = 0;
            statusBar.text = '$(clock) Copilot: --';
            statusBar.tooltip = 'GitHub Copilot Chat Timer — reset';
            statusBar.color = undefined;
            out.appendLine('Reset by user.');
        })
    );
}

export function deactivate(): void { /* nothing to clean up */ }
