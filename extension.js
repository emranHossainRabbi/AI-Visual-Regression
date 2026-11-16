/**
 * @author Emran Hossain Rabbi
 * @since 11/15/2026
 *
 * AI Visual Regression Runner & Analyzer - VS Code / Antigravity Extension
 *
 * Multi-LLM Cross-Environment Visual Regression Testing powered by Playwright
 * and Vision AI (Google Gemini, OpenAI GPT-4o, Anthropic Claude) with real-time test
 * execution, interactive defect inspection, side-by-side canvas difference annotations,
 * and instant in-editor HTML report viewing.
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// =========================================================================
// 🔑 IN-CODE API KEYS (Default fallbacks for seamless out-of-the-box usage)
// =========================================================================
const IN_CODE_API_KEYS = {
    gemini: '',
    openai: '',
    claude: ''
};

class AIVisualRunnerViewProvider {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this._context = context;
        this._view = undefined;
        this._currentProcess = null;
        this._lastReport = null;
        this._lastConfig = null;
        this._reportPanel = null;
    }

    /**
     * @param {vscode.WebviewView} webviewView
     * @param {vscode.WebviewViewResolveContext} context
     * @param {vscode.CancellationToken} token
     */
    resolveWebviewView(webviewView, context, token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._context.extensionUri,
                ...(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.map(f => f.uri) : [])
            ]
        };

        const savedState = this._context.workspaceState.get('aiVisualRunnerFormState') || this._context.globalState.get('aiVisualRunnerFormState') || {};
        webviewView.webview.html = this._getHtmlForWebview(savedState);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case 'saveFormState':
                    await this._context.workspaceState.update('aiVisualRunnerFormState', data.state);
                    await this._context.globalState.update('aiVisualRunnerFormState', data.state);
                    break;
                case 'runTest':
                    await this._context.workspaceState.update('aiVisualRunnerFormState', data.config);
                    await this._context.globalState.update('aiVisualRunnerFormState', data.config);
                    await this.runVisualTest(data.config);
                    break;
                case 'stopTest':
                    this.stopVisualTest();
                    break;
                case 'openHtmlReport':
                    this.openReportInEditor();
                    break;
                case 'openExternalReport':
                    this.openReportInBrowser();
                    break;
                case 'reanalyze':
                    await this.reanalyzeWithAI(data.modelName, data.uiKeys);
                    break;
                case 'saveApiKey':
                    await this.saveApiKey(data.provider, data.key);
                    break;
                case 'getSavedKeys':
                    this.sendSavedKeys();
                    break;
                case 'openResultsFolder':
                    this.openResultsFolder();
                    break;
                case 'showNotification':
                    vscode.window.showInformationMessage(data.text);
                    break;
            }
        });

        // Send saved API keys to UI when webview resolves
        this.sendSavedKeys();

        // Also check if existing report exists from previous run
        this.loadExistingReport();
    }

    getProviderForModel(modelName = '') {
        const lower = modelName.toLowerCase();
        if (lower.startsWith('gemini')) return 'gemini';
        if (lower.startsWith('claude')) return 'claude';
        return 'openai';
    }

    /**
     * Resolves API Key by priority: UI input -> In-code fallback -> VS Code Settings -> Environment variable
     */
    resolveApiKey(provider = 'gemini', uiKey = '') {
        if (uiKey && uiKey.trim()) return uiKey.trim();
        if (IN_CODE_API_KEYS[provider] && IN_CODE_API_KEYS[provider].trim()) {
            return IN_CODE_API_KEYS[provider].trim();
        }

        const extConfig = vscode.workspace.getConfiguration('aiVisualRunner');
        let configKey = 'geminiApiKey';
        if (provider === 'openai') configKey = 'openaiApiKey';
        if (provider === 'claude') configKey = 'claudeApiKey';

        const settingKey = extConfig.get(configKey);
        if (settingKey && settingKey.trim()) return settingKey.trim();

        if (provider === 'gemini') return process.env.GEMINI_API_KEY || '';
        if (provider === 'openai') return process.env.OPENAI_API_KEY || '';
        if (provider === 'claude') return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
        return '';
    }

    async saveApiKey(provider, key) {
        const extConfig = vscode.workspace.getConfiguration('aiVisualRunner');
        let configKey = 'geminiApiKey';
        if (provider === 'openai') configKey = 'openaiApiKey';
        if (provider === 'claude') configKey = 'claudeApiKey';

        await extConfig.update(configKey, key, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`${provider.toUpperCase()} API Key saved to global settings.`);
        if (this._view) {
            this._view.webview.postMessage({ command: 'keySaved', provider: provider });
        }
    }

    sendSavedKeys() {
        if (!this._view) return;
        this._view.webview.postMessage({
            command: 'initSavedKeys',
            keys: {
                gemini: this.resolveApiKey('gemini'),
                openai: this.resolveApiKey('openai'),
                claude: this.resolveApiKey('claude')
            }
        });
    }

    getWorkspaceRoot() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
        return process.cwd();
    }

    /**
     * Checks if test-results/ai-report.json exists and notifies webview
     */
    loadExistingReport() {
        try {
            const root = this.getWorkspaceRoot();
            const jsonPath = path.join(root, 'test-results', 'ai-report.json');
            const htmlPath = path.join(root, 'test-results', 'ai-visual-report.html');
            if (fs.existsSync(jsonPath)) {
                const reportContent = fs.readFileSync(jsonPath, 'utf-8');
                const report = JSON.parse(reportContent);
                this._lastReport = report;

                let imagesData = this.getScreenshotDataUrls(root);

                this._view.webview.postMessage({
                    command: 'reportLoaded',
                    report: report,
                    hasHtmlReport: fs.existsSync(htmlPath),
                    images: imagesData
                });
            }
        } catch (_) {}
    }

    /**
     * Reads Baseline and Candidate screenshots from test-results as data URLs
     */
    getScreenshotDataUrls(root) {
        const resultsDir = path.join(root, 'test-results');
        const images = { baseline: null, candidate: null };

        try {
            const files = fs.readdirSync(resultsDir);
            for (const f of files) {
                const lower = f.toLowerCase();
                const fullPath = path.join(resultsDir, f);
                if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
                    if (lower.includes('baseline') || lower.includes('old')) {
                        const mime = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
                        images.baseline = `data:${mime};base64,` + fs.readFileSync(fullPath).toString('base64');
                    } else if (lower.includes('candidate') || lower.includes('new')) {
                        const mime = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
                        images.candidate = `data:${mime};base64,` + fs.readFileSync(fullPath).toString('base64');
                    }
                }
            }
        } catch (_) {}

        return images;
    }

    stopVisualTest() {
        if (this._currentProcess) {
            const { exec } = require('child_process');
            if (process.platform === 'win32') {
                exec(`taskkill /pid ${this._currentProcess.pid} /T /F`);
            } else {
                this._currentProcess.kill('SIGKILL');
            }
            this._currentProcess = null;
            if (this._view) {
                this._view.webview.postMessage({ command: 'log', text: '\n\n[!] Test execution halted by user.\n' });
                this._view.webview.postMessage({ command: 'testCompleted', status: 'stopped' });
            }
        }
    }

    /**
     * Runs the Playwright Cross-Environment AI Visual Regression Test
     */
    async runVisualTest(config) {
        if (!this._view) return;
        this._lastConfig = config;

        // Validation
        if (!config.oldBaseUrl || !config.newBaseUrl) {
            vscode.window.showErrorMessage('Both Baseline and Candidate Base URLs are required.');
            this._view.webview.postMessage({ command: 'testCompleted', status: 'error', error: 'Missing Base URLs' });
            return;
        }

        if (this._currentProcess) {
            this.stopVisualTest();
        }

        const workspaceRoot = this.getWorkspaceRoot();
        const selectedModel = config.aiModel || 'gemini-3.8-flash';
        const provider = this.getProviderForModel(selectedModel);
        const resolvedApiKey = this.resolveApiKey(provider, config.apiKeys ? config.apiKeys[provider] : '');

        if (!resolvedApiKey) {
            vscode.window.showWarningMessage(`No ${provider.toUpperCase()} API Key provided. Make sure it is set before running.`);
        }

        this._view.webview.postMessage({ command: 'testStarted' });
        this._view.webview.postMessage({
            command: 'log',
            text: `[AI-Visual] Initializing Visual Regression Runner...\n` +
                  `[AI-Visual] Baseline:    ${config.oldBaseUrl}\n` +
                  `[AI-Visual] Candidate:   ${config.newBaseUrl}\n` +
                  `[AI-Visual] AI Provider: ${provider.toUpperCase()}\n` +
                  `[AI-Visual] AI Model:    ${selectedModel}\n` +
                  `[AI-Visual] Headed:      ${config.headed ? 'Yes' : 'No'}\n` +
                  `------------------------------------------------------------\n`
        });

        // Set up execution environment variables
        const testEnv = {
            ...process.env,
            OLD_BASE_URL: config.oldBaseUrl,
            OLD_LOGIN_NAME: config.oldLoginName || '',
            OLD_PASSWORD: config.oldPassword || '',
            OLD_LOGIN_PATH: config.oldLoginPath || '',
            OLD_TARGET_PAGE: config.oldTargetPage || '',
            NEW_BASE_URL: config.newBaseUrl,
            NEW_LOGIN_NAME: config.newLoginName || '',
            NEW_PASSWORD: config.newPassword || '',
            NEW_LOGIN_PATH: config.newLoginPath || '',
            NEW_TARGET_PAGE: config.newTargetPage || '',
            AI_MODEL: selectedModel,
            GEMINI_MODEL: selectedModel,
            API_KEY: resolvedApiKey,
            GEMINI_API_KEY: provider === 'gemini' ? resolvedApiKey : (this.resolveApiKey('gemini') || ''),
            OPENAI_API_KEY: provider === 'openai' ? resolvedApiKey : (this.resolveApiKey('openai') || ''),
            ANTHROPIC_API_KEY: provider === 'claude' ? resolvedApiKey : (this.resolveApiKey('claude') || ''),
            TARGET_PAGE: config.newTargetPage || config.oldTargetPage || ''
        };

        const runnerScript = path.join(__dirname, 'runner.js');
        const nodeBinary = 'node';

        testEnv.WORKSPACE_ROOT = workspaceRoot;
        testEnv.HEADED = config.headed ? 'true' : 'false';

        try {
            this._currentProcess = spawn(nodeBinary, [`"${runnerScript}"`], {
                cwd: workspaceRoot,
                env: testEnv,
                shell: true
            });

            this._currentProcess.stdout.on('data', (data) => {
                const text = data.toString();
                this._view.webview.postMessage({ command: 'log', text });
            });

            this._currentProcess.stderr.on('data', (data) => {
                const text = data.toString();
                this._view.webview.postMessage({ command: 'log', text });
            });

            this._currentProcess.on('close', (code) => {
                this._currentProcess = null;
                const status = (code === 0) ? 'success' : 'completed_with_findings';

                // Look for generated JSON and HTML reports
                const jsonReportPath = path.join(workspaceRoot, 'test-results', 'ai-report.json');
                const htmlReportPath = path.join(workspaceRoot, 'test-results', 'ai-visual-report.html');

                let report = null;
                if (fs.existsSync(jsonReportPath)) {
                    try {
                        report = JSON.parse(fs.readFileSync(jsonReportPath, 'utf-8'));
                        this._lastReport = report;
                    } catch (_) {}
                }

                const imagesData = this.getScreenshotDataUrls(workspaceRoot);

                this._view.webview.postMessage({
                    command: 'testCompleted',
                    exitCode: code,
                    status: status,
                    report: report,
                    hasHtmlReport: fs.existsSync(htmlReportPath),
                    images: imagesData
                });

                if (report) {
                    const diffCount = report.differences ? report.differences.length : 0;
                    if (report.hasCriticalDefects) {
                        vscode.window.showWarningMessage(
                            `AI Visual Regression finished: ${diffCount} difference(s) detected with ${selectedModel}.`,
                            'View HTML Report'
                        ).then(choice => {
                            if (choice === 'View HTML Report') this.openReportInEditor();
                        });
                    } else {
                        vscode.window.showInformationMessage(
                            `AI Visual Regression passed! ${diffCount} minor difference(s) detected.`,
                            'View Report'
                        ).then(choice => {
                            if (choice === 'View Report') this.openReportInEditor();
                        });
                    }
                }
            });

            this._currentProcess.on('error', (err) => {
                this._currentProcess = null;
                this._view.webview.postMessage({
                    command: 'log',
                    text: `\n[Error] Failed to spawn Playwright runner: ${err.message}\n`
                });
                this._view.webview.postMessage({ command: 'testCompleted', status: 'error', error: err.message });
            });

        } catch (err) {
            this._currentProcess = null;
            this._view.webview.postMessage({ command: 'log', text: `\n[Exception]: ${err.message}\n` });
            this._view.webview.postMessage({ command: 'testCompleted', status: 'error', error: err.message });
        }
    }

    /**
     * Re-analyzes cached screenshots using the selected AI model directly
     */
    async reanalyzeWithAI(modelName, uiKeys = {}) {
        if (!this._view) return;
        const root = this.getWorkspaceRoot();
        const resultsDir = path.join(root, 'test-results');

        // Look for screenshots
        let oldPath = null;
        let newPath = null;
        try {
            const files = fs.readdirSync(resultsDir);
            for (const f of files) {
                const lower = f.toLowerCase();
                if (lower.includes('baseline') || lower.includes('old')) oldPath = path.join(resultsDir, f);
                if (lower.includes('candidate') || lower.includes('new')) newPath = path.join(resultsDir, f);
            }
        } catch (_) {}

        if (!oldPath || !newPath || !fs.existsSync(oldPath) || !fs.existsSync(newPath)) {
            vscode.window.showErrorMessage('No captured screenshots found in test-results/. Please run a visual test first.');
            return;
        }

        const provider = this.getProviderForModel(modelName);
        const apiKey = this.resolveApiKey(provider, uiKeys[provider]);

        if (!apiKey) {
            vscode.window.showErrorMessage(`${provider.toUpperCase()} API Key is required for re-analysis.`);
            return;
        }

        this._view.webview.postMessage({
            command: 'log',
            text: `\n[AI-Visual] Re-evaluating screenshots with model: ${modelName} (${provider.toUpperCase()})...\n`
        });

        // Re-execute playwright test passing the new model to trigger compare
        const config = {
            ...this._lastConfig,
            aiModel: modelName,
            apiKeys: uiKeys
        };
        await this.runVisualTest(config);
    }

    /**
     * Opens the rich HTML report inside a native VS Code Webview Tab
     */
    openReportInEditor() {
        const root = this.getWorkspaceRoot();
        const htmlPath = path.join(root, 'test-results', 'ai-visual-report.html');

        if (!fs.existsSync(htmlPath)) {
            vscode.window.showWarningMessage('No HTML report found at test-results/ai-visual-report.html. Run a test first.');
            return;
        }

        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

        if (this._reportPanel) {
            this._reportPanel.reveal(vscode.ViewColumn.One);
            this._reportPanel.webview.html = htmlContent;
        } else {
            this._reportPanel = vscode.window.createWebviewPanel(
                'aiVisualReportView',
                'AI Visual Regression Report',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this._reportPanel.webview.html = htmlContent;
            this._reportPanel.onDidDispose(() => {
                this._reportPanel = null;
            }, null, this._context.subscriptions);
        }
    }

    /**
     * Opens the HTML report in external default browser
     */
    openReportInBrowser() {
        const root = this.getWorkspaceRoot();
        const htmlPath = path.join(root, 'test-results', 'ai-visual-report.html');
        if (fs.existsSync(htmlPath)) {
            vscode.env.openExternal(vscode.Uri.file(htmlPath));
        } else {
            vscode.window.showWarningMessage('No HTML report found to open.');
        }
    }

    openResultsFolder() {
        const root = this.getWorkspaceRoot();
        const resultsDir = path.join(root, 'test-results');
        if (fs.existsSync(resultsDir)) {
            vscode.env.openExternal(vscode.Uri.file(resultsDir));
        } else {
            vscode.window.showInformationMessage('test-results/ directory does not exist yet.');
        }
    }

    /**
     * Builds the full HTML/CSS/JS user interface for the extension sidebar
     */
    _getHtmlForWebview(savedState = {}) {
        const escapeHtml = (unsafe) => (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Visual Regression Runner</title>
<style>
    :root {
        --primary: #8b5cf6;
        --primary-hover: #7c3aed;
        --success: #10b981;
        --danger: #ef4444;
        --warning: #f59e0b;
        --border-color: var(--vscode-widget-border, #334155);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: var(--vscode-font-size, 12px);
        color: var(--vscode-foreground);
        background-color: var(--vscode-sideBar-background);
        padding: 12px;
        line-height: 1.4;
    }
    h2, h3 { font-weight: 600; margin-bottom: 8px; }
    h2 { font-size: 14px; display: flex; align-items: center; gap: 6px; }
    h3 { font-size: 12px; color: var(--vscode-sideBarTitle-foreground, #94a3b8); text-transform: uppercase; letter-spacing: 0.5px; }

    .header-banner {
        background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(6, 182, 212, 0.15));
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-radius: 6px;
        padding: 10px 12px;
        margin-bottom: 12px;
    }
    .header-banner h1 { font-size: 14px; font-weight: 700; color: #a78bfa; margin-bottom: 2px; }
    .header-banner p { font-size: 11px; opacity: 0.8; }

    .section {
        background: var(--vscode-editor-background);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 10px;
        margin-bottom: 10px;
    }
    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        user-select: none;
    }
    .section-content { margin-top: 8px; }
    .section-content.collapsed { display: none; }

    label {
        display: block;
        font-size: 11px;
        font-weight: 500;
        margin-top: 6px;
        margin-bottom: 2px;
        color: var(--vscode-descriptionForeground, #94a3b8);
    }
    input[type="text"], input[type="password"], select, textarea {
        width: 100%;
        padding: 6px 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, #475569);
        border-radius: 4px;
        font-size: 11px;
        font-family: inherit;
    }
    input:focus, select:focus, textarea:focus {
        outline: 1px solid var(--primary);
        border-color: var(--primary);
    }

    .row { display: flex; gap: 6px; align-items: center; }
    .col { flex: 1; }

    button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 7px 12px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        user-select: none;
    }
    .btn-primary {
        background: var(--primary);
        color: #fff;
        width: 100%;
    }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-danger {
        background: var(--danger);
        color: #fff;
        width: 100%;
    }
    .btn-secondary {
        background: var(--vscode-button-secondaryBackground, #334155);
        color: var(--vscode-button-secondaryForeground, #fff);
    }
    .btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground, #475569);
    }
    .btn-outline {
        background: transparent;
        border: 1px solid var(--border-color);
        color: var(--vscode-foreground);
    }
    .btn-outline:hover { background: rgba(255, 255, 255, 0.05); }

    .btn-group { display: flex; gap: 6px; margin-top: 10px; }

    .terminal-box {
        background: #0f172a;
        color: #e2e8f0;
        font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
        font-size: 11px;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid #1e293b;
        height: 140px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-all;
        margin-top: 8px;
    }

    .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }
    .badge-pass { background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; }
    .badge-fail { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444; }

    .stat-row { display: flex; gap: 6px; margin: 8px 0; }
    .stat-pill {
        flex: 1;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        padding: 6px 4px;
        text-align: center;
    }
    .stat-pill .num { font-size: 14px; font-weight: 700; }
    .stat-pill .label { font-size: 9px; opacity: 0.7; }
    .stat-pill.crit .num { color: #ef4444; }
    .stat-pill.high .num { color: #f97316; }
    .stat-pill.med .num { color: #f59e0b; }
    .stat-pill.low .num { color: #eab308; }

    .diff-list { max-height: 220px; overflow-y: auto; margin-top: 8px; }
    .diff-item {
        background: rgba(255, 255, 255, 0.03);
        border-left: 3px solid var(--border-color);
        padding: 6px 8px;
        margin-bottom: 6px;
        border-radius: 0 4px 4px 0;
        cursor: pointer;
        transition: background 0.15s;
    }
    .diff-item:hover { background: rgba(255, 255, 255, 0.07); }
    .diff-item.crit { border-left-color: #ef4444; }
    .diff-item.high { border-left-color: #f97316; }
    .diff-item.med { border-left-color: #f59e0b; }
    .diff-item.low { border-left-color: #eab308; }
    .diff-item-title { font-weight: 600; font-size: 11px; display: flex; justify-content: space-between; }
    .diff-item-desc { font-size: 10px; opacity: 0.8; margin-top: 2px; }

    .image-preview-container {
        display: flex;
        gap: 6px;
        margin-top: 8px;
    }
    .preview-box {
        flex: 1;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        overflow: hidden;
        background: #000;
        text-align: center;
    }
    .preview-box h4 {
        font-size: 9px;
        padding: 3px;
        background: rgba(255, 255, 255, 0.05);
        color: #94a3b8;
    }
    .preview-box img {
        width: 100%;
        max-height: 120px;
        object-fit: contain;
        display: block;
    }

    .hidden { display: none !important; }
</style>
</head>
<body>

<div class="header-banner">
    <h1>🔍 AI Visual Regression</h1>
    <p>Multi-LLM Visual Engine (Gemini &bull; OpenAI &bull; Claude)</p>
</div>

<!-- 1. BASELINE ENVIRONMENT -->
<div class="section" style="border-left: 3px solid #06b6d4;">
    <div class="section-header" onclick="toggleSection('baselineSec')">
        <h3>🟦 Baseline (Old / Stable)</h3>
        <span id="baselineSecArrow">▼</span>
    </div>
    <div id="baselineSec" class="section-content">
        <label>Base URL</label>
        <input type="text" id="oldBaseUrl" value="${escapeHtml(savedState.oldBaseUrl)}" placeholder="https://baseline-env.com">

        <div class="row">
            <div class="col">
                <label>Login Name</label>
                <input type="text" id="oldLoginName" value="${escapeHtml(savedState.oldLoginName)}">
            </div>
        </div>

        <div class="row">
            <div class="col">
                <label>Password</label>
                <input type="password" id="oldPassword" value="${escapeHtml(savedState.oldPassword)}">
            </div>
            <button type="button" class="btn-outline" style="margin-top: 18px; padding: 5px 8px;" onclick="togglePasswordVisibility('oldPassword')">👁️</button>
        </div>

        <div class="row">
            <div class="col">
                <label>Login Path (Optional)</label>
                <input type="text" id="oldLoginPath" value="${escapeHtml(savedState.oldLoginPath)}" placeholder="e.g. /login">
            </div>
            <div class="col">
                <label>Target Page Path or URL</label>
                <input type="text" id="oldTargetPage" value="${escapeHtml(savedState.oldTargetPage)}" placeholder="e.g. /dashboard">
            </div>
        </div>
    </div>
</div>

<!-- 2. CANDIDATE ENVIRONMENT -->
<div class="section" style="border-left: 3px solid #8b5cf6;">
    <div class="section-header" onclick="toggleSection('candidateSec')">
        <h3>🟥 Candidate (New / QA)</h3>
        <span id="candidateSecArrow">▼</span>
    </div>
    <div id="candidateSec" class="section-content">
        <div style="display: flex; justify-content: flex-end; margin-bottom: 4px;">
            <button type="button" class="btn-outline" style="font-size: 10px; padding: 2px 6px;" onclick="copyBaselineCreds()">📋 Copy Credentials</button>
        </div>
        <label>Base URL</label>
        <input type="text" id="newBaseUrl" value="${escapeHtml(savedState.newBaseUrl)}" placeholder="https://candidate-env.com">

        <div class="row">
            <div class="col">
                <label>Login Name</label>
                <input type="text" id="newLoginName" value="${escapeHtml(savedState.newLoginName)}">
            </div>
        </div>

        <div class="row">
            <div class="col">
                <label>Password</label>
                <input type="password" id="newPassword" value="${escapeHtml(savedState.newPassword)}">
            </div>
            <button type="button" class="btn-outline" style="margin-top: 18px; padding: 5px 8px;" onclick="togglePasswordVisibility('newPassword')">👁️</button>
        </div>

        <div class="row">
            <div class="col">
                <label>Login Path (Optional)</label>
                <input type="text" id="newLoginPath" value="${escapeHtml(savedState.newLoginPath)}" placeholder="e.g. /login">
            </div>
            <div class="col">
                <label>Target Page Path or URL</label>
                <input type="text" id="newTargetPage" value="${escapeHtml(savedState.newTargetPage)}" placeholder="e.g. /dashboard">
            </div>
        </div>
    </div>
</div>

<!-- 3. MULTI-AI MODEL & PROVIDER SELECTION -->
<div class="section" style="border-color: #a855f7;">
    <div class="section-header" onclick="toggleSection('settingsSec')">
        <h3>🤖 AI Model &amp; Provider</h3>
        <span id="settingsSecArrow">▼</span>
    </div>
    <div id="settingsSec" class="section-content">
        <label>Select AI Vision Model</label>
        <select id="aiModel" onchange="onModelChange()">
            <optgroup label="Google Gemini">
                <option value="gemini-3.8-flash" selected>Google Gemini (3.8 Flash - Recommended)</option>
                <option value="gemini-3.5-flash-lite">Google Gemini (3.5 Flash-Lite - Fast)</option>
                <option value="gemini-2.5-pro">Google Gemini (2.5 Pro - Deep Audit)</option>
            </optgroup>
            <optgroup label="OpenAI (ChatGPT Vision)">
                <option value="gpt-4o">OpenAI ChatGPT (GPT-4o - Flagship Vision)</option>
                <option value="gpt-4o-mini">OpenAI ChatGPT (GPT-4o Mini - Fast)</option>
                <option value="o3-mini">OpenAI (o3-mini - Reasoning Vision)</option>
            </optgroup>
            <optgroup label="Anthropic Claude">
                <option value="claude-3-5-sonnet-20241022">Anthropic Claude (3.5 Sonnet - Precision UI)</option>
                <option value="claude-3-5-haiku-20241022">Anthropic Claude (3.5 Haiku - Fast)</option>
            </optgroup>
        </select>

        <label id="apiKeyLabel">Google Gemini API Key</label>
        <div class="row">
            <input type="password" id="apiKeyInput" placeholder="Using in-code / env fallback key">
            <button type="button" class="btn-outline" style="padding: 5px 8px;" onclick="togglePasswordVisibility('apiKeyInput')">👁️</button>
            <button type="button" class="btn-secondary" style="padding: 5px 8px;" onclick="saveApiKey()">💾</button>
        </div>
        <span id="keySavedNotice" style="font-size: 10px; color: #10b981; display: none;">Saved!</span>

        <div style="margin-top: 8px;">
            <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                <input type="checkbox" id="headedCheckbox"> Run in Headed Browser Mode (Visible UI)
            </label>
        </div>
    </div>
</div>

<!-- 4. ACTION BUTTONS -->
<div style="margin-bottom: 12px;">
    <button id="runBtn" class="btn-primary" onclick="startTest()">
        ▶ Run Visual Regression Test
    </button>
    <button id="stopBtn" class="btn-danger hidden" onclick="stopTest()">
        ⏹ Stop Test Execution
    </button>
</div>

<!-- 5. TERMINAL LOGS -->
<div class="section">
    <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3>Execution Logs</h3>
        <button class="btn-outline" style="font-size: 10px; padding: 2px 6px;" onclick="clearLogs()">Clear</button>
    </div>
    <div id="terminal" class="terminal-box">Ready. Click 'Run Visual Regression Test' to start.</div>
</div>

<!-- 6. RESULTS & DEFECT DASHBOARD -->
<div id="resultsSection" class="section hidden">
    <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3>Audit Summary</h3>
        <span id="statusBadge" class="badge"></span>
    </div>

    <div class="stat-row">
        <div class="stat-pill"><div id="statTotal" class="num">0</div><div class="label">Total</div></div>
        <div class="stat-pill crit"><div id="statCrit" class="num">0</div><div class="label">Crit</div></div>
        <div class="stat-pill high"><div id="statHigh" class="num">0</div><div class="label">High</div></div>
        <div class="stat-pill med"><div id="statMed" class="num">0</div><div class="label">Med</div></div>
        <div class="stat-pill low"><div id="statLow" class="num">0</div><div class="label">Low</div></div>
    </div>

    <!-- Screenshots Preview -->
    <div id="imagePreviewContainer" class="image-preview-container hidden">
        <div class="preview-box">
            <h4>Baseline</h4>
            <img id="imgBaseline" alt="Baseline screenshot">
        </div>
        <div class="preview-box">
            <h4>Candidate</h4>
            <img id="imgCandidate" alt="Candidate screenshot">
        </div>
    </div>

    <!-- Differences list -->
    <label style="margin-top: 8px;">Detected Differences:</label>
    <div id="diffList" class="diff-list"></div>

    <div class="btn-group">
        <button class="btn-primary" style="flex: 1;" onclick="openHtmlReport()">📊 Open HTML Report</button>
        <button class="btn-secondary" style="flex: 1;" onclick="reanalyzeWithAI()">🔄 Re-analyze with Selected Model</button>
    </div>
    <div style="margin-top: 6px;">
        <button class="btn-outline" style="width: 100%; font-size: 10px;" onclick="openResultsFolder()">📁 Open test-results folder</button>
    </div>
</div>

<script>
    const vscode = acquireVsCodeApi();

    const storedKeys = {
        gemini: '',
        openai: '',
        claude: ''
    };

    function getProvider(model) {
        const m = (model || '').toLowerCase();
        if (m.startsWith('gemini')) return 'gemini';
        if (m.startsWith('claude')) return 'claude';
        return 'openai';
    }

    function onModelChange() {
        const model = document.getElementById('aiModel').value;
        const provider = getProvider(model);
        const label = document.getElementById('apiKeyLabel');
        const input = document.getElementById('apiKeyInput');

        if (provider === 'gemini') {
            label.textContent = 'Google Gemini API Key';
            input.placeholder = storedKeys.gemini ? 'Stored / In-Code Key Active' : 'Paste Gemini Key...';
            input.value = storedKeys.gemini || '';
        } else if (provider === 'openai') {
            label.textContent = 'OpenAI (ChatGPT) API Key';
            input.placeholder = storedKeys.openai ? 'Stored Key Active' : 'Paste OpenAI Key...';
            input.value = storedKeys.openai || '';
        } else if (provider === 'claude') {
            label.textContent = 'Anthropic Claude API Key';
            input.placeholder = storedKeys.claude ? 'Stored Key Active' : 'Paste Claude Key...';
            input.value = storedKeys.claude || '';
        }
    }

    function toggleSection(id) {
        const sec = document.getElementById(id);
        const arrow = document.getElementById(id + 'Arrow');
        if (sec.classList.contains('collapsed')) {
            sec.classList.remove('collapsed');
            if (arrow) arrow.textContent = '▼';
        } else {
            sec.classList.add('collapsed');
            if (arrow) arrow.textContent = '▶';
        }
    }

    function togglePasswordVisibility(id) {
        const input = document.getElementById(id);
        input.type = (input.type === 'password') ? 'text' : 'password';
    }

    function copyBaselineCreds() {
        document.getElementById('newLoginName').value = document.getElementById('oldLoginName').value;
        document.getElementById('newLoginPath').value = document.getElementById('oldLoginPath').value;
        document.getElementById('newPassword').value = document.getElementById('oldPassword').value;
        saveFormState();
        vscode.postMessage({ command: 'showNotification', text: 'Baseline credentials copied to Candidate.' });
    }

    function saveFormState() {
        const state = {
            oldBaseUrl: document.getElementById('oldBaseUrl').value.trim(),
            oldLoginName: document.getElementById('oldLoginName').value.trim(),
            oldPassword: document.getElementById('oldPassword').value,
            oldLoginPath: document.getElementById('oldLoginPath').value.trim(),
            oldTargetPage: document.getElementById('oldTargetPage').value.trim(),
            newBaseUrl: document.getElementById('newBaseUrl').value.trim(),
            newLoginName: document.getElementById('newLoginName').value.trim(),
            newPassword: document.getElementById('newPassword').value,
            newLoginPath: document.getElementById('newLoginPath').value.trim(),
            newTargetPage: document.getElementById('newTargetPage').value.trim()
        };
        vscode.postMessage({ command: 'saveFormState', state: state });
    }

    // Auto-save state when inputs lose focus or change
    document.querySelectorAll('input[type="text"], input[type="password"]').forEach(input => {
        input.addEventListener('change', saveFormState);
        input.addEventListener('blur', saveFormState);
    });

    function saveApiKey() {
        const model = document.getElementById('aiModel').value;
        const provider = getProvider(model);
        const key = document.getElementById('apiKeyInput').value.trim();
        storedKeys[provider] = key;
        vscode.postMessage({ command: 'saveApiKey', provider: provider, key: key });
    }

    function clearLogs() {
        document.getElementById('terminal').textContent = '';
    }

    function startTest() {
        const model = document.getElementById('aiModel').value;
        const provider = getProvider(model);
        storedKeys[provider] = document.getElementById('apiKeyInput').value.trim();

        const config = {
            oldBaseUrl: document.getElementById('oldBaseUrl').value.trim(),
            oldLoginName: document.getElementById('oldLoginName').value.trim(),
            oldPassword: document.getElementById('oldPassword').value,
            oldLoginPath: document.getElementById('oldLoginPath').value.trim(),
            oldTargetPage: document.getElementById('oldTargetPage').value.trim(),
            newBaseUrl: document.getElementById('newBaseUrl').value.trim(),
            newLoginName: document.getElementById('newLoginName').value.trim(),
            newPassword: document.getElementById('newPassword').value,
            newLoginPath: document.getElementById('newLoginPath').value.trim(),
            newTargetPage: document.getElementById('newTargetPage').value.trim(),
            aiModel: model,
            apiKeys: storedKeys,
            headed: document.getElementById('headedCheckbox').checked
        };

        vscode.postMessage({ command: 'runTest', config: config });
    }

    function stopTest() {
        vscode.postMessage({ command: 'stopTest' });
    }

    function openHtmlReport() {
        vscode.postMessage({ command: 'openHtmlReport' });
    }

    function openResultsFolder() {
        vscode.postMessage({ command: 'openResultsFolder' });
    }

    function reanalyzeWithAI() {
        const model = document.getElementById('aiModel').value;
        const provider = getProvider(model);
        storedKeys[provider] = document.getElementById('apiKeyInput').value.trim();

        vscode.postMessage({
            command: 'reanalyze',
            modelName: model,
            uiKeys: storedKeys
        });
    }

    // Message handler from Extension Host
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'initSavedKeys':
                if (message.keys) {
                    storedKeys.gemini = message.keys.gemini || '';
                    storedKeys.openai = message.keys.openai || '';
                    storedKeys.claude = message.keys.claude || '';
                    onModelChange();
                }
                break;

            case 'keySaved':
                const notice = document.getElementById('keySavedNotice');
                notice.style.display = 'inline';
                setTimeout(() => notice.style.display = 'none', 2500);
                break;

            case 'testStarted':
                document.getElementById('runBtn').classList.add('hidden');
                document.getElementById('stopBtn').classList.remove('hidden');
                document.getElementById('terminal').textContent = '';
                break;

            case 'log':
                const terminal = document.getElementById('terminal');
                terminal.textContent += message.text;
                terminal.scrollTop = terminal.scrollHeight;
                break;

            case 'testCompleted':
                document.getElementById('runBtn').classList.remove('hidden');
                document.getElementById('stopBtn').classList.add('hidden');
                if (message.report) {
                    renderReport(message.report, message.images);
                }
                break;

            case 'reportLoaded':
                if (message.report) {
                    renderReport(message.report, message.images);
                }
                break;
        }
    });

    function renderReport(report, images) {
        const resultsSec = document.getElementById('resultsSection');
        resultsSec.classList.remove('hidden');

        const diffs = report.differences || [];
        const hasCrit = report.hasCriticalDefects;

        const badge = document.getElementById('statusBadge');
        if (hasCrit) {
            badge.className = 'badge badge-fail';
            badge.textContent = '❌ REGRESSIONS DETECTED';
        } else {
            badge.className = 'badge badge-pass';
            badge.textContent = '✅ PASSED';
        }

        let crit = 0, high = 0, med = 0, low = 0;
        diffs.forEach(d => {
            const sev = (d.severity || '').toLowerCase();
            if (sev === 'critical') crit++;
            else if (sev === 'high') high++;
            else if (sev === 'medium') med++;
            else if (sev === 'low') low++;
        });

        document.getElementById('statTotal').textContent = diffs.length;
        document.getElementById('statCrit').textContent = crit;
        document.getElementById('statHigh').textContent = high;
        document.getElementById('statMed').textContent = med;
        document.getElementById('statLow').textContent = low;

        if (images && images.baseline && images.candidate) {
            document.getElementById('imagePreviewContainer').classList.remove('hidden');
            document.getElementById('imgBaseline').src = images.baseline;
            document.getElementById('imgCandidate').src = images.candidate;
        }

        const diffList = document.getElementById('diffList');
        diffList.innerHTML = '';

        if (diffs.length === 0) {
            diffList.innerHTML = '<div style="font-size:11px; opacity:0.6; padding:8px; text-align:center;">No differences detected.</div>';
            return;
        }

        diffs.forEach((d, idx) => {
            const sev = (d.severity || 'low').toLowerCase();
            const item = document.createElement('div');
            item.className = 'diff-item ' + (sev === 'critical' ? 'crit' : sev);
            item.onclick = () => openHtmlReport();

            const coordStr = d.rect ? (' [x:' + d.rect.x + ', y:' + d.rect.y + ']') : '';
            item.innerHTML = \`
                <div class="diff-item-title">
                    <span>#\${idx + 1} \${d.element || 'Element'}</span>
                    <span style="font-size:9px; text-transform:uppercase; font-weight:700;">\${d.severity || ''}</span>
                </div>
                <div class="diff-item-desc">\${d.description || ''}\${coordStr}</div>
            \`;
            diffList.appendChild(item);
        });
    }

    // Request saved keys on start
    vscode.postMessage({ command: 'getSavedKeys' });
</script>
</body>
</html>`;
    }
}

function activate(context) {
    const provider = new AIVisualRunnerViewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('aiVisualRunnerView', provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aiVisualRunner.openPanel', () => {
            vscode.commands.executeCommand('workbench.view.extension.ai-visual-runner-container');
        }),
        vscode.commands.registerCommand('aiVisualRunner.runTest', () => {
            vscode.commands.executeCommand('workbench.view.extension.ai-visual-runner-container');
        }),
        vscode.commands.registerCommand('aiVisualRunner.openReport', () => {
            provider.openReportInEditor();
        })
    );

    console.log('[AI Visual Runner] Multi-LLM Extension activated.');
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
