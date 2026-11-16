/**
 * @author Principal SDET Architect
 * @since 11/15/2026
 *
 * Standalone Playwright Visual Regression Engine
 * Bundled inside the AI Visual Runner Extension.
 *
 * Executes full cross-environment testing without requiring any test files
 * in the target workspace.
 */

const fs = require('fs');
const path = require('path');

// Resolve Playwright: try target project node_modules first, fallback to extension node_modules or global
let playwright = null;
const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();

const resolvePlaywright = () => {
    const candidatePaths = [
        path.join(workspaceRoot, 'node_modules', 'playwright'),
        path.join(__dirname, 'node_modules', 'playwright'),
        path.join(workspaceRoot, 'node_modules', 'playwright-core'),
        path.join(__dirname, 'node_modules', 'playwright-core')
    ];

    for (const p of candidatePaths) {
        try {
            if (fs.existsSync(p)) {
                return require(p);
            }
        } catch (_) {}
    }

    try {
        return require('playwright');
    } catch (_) {
        try {
            return require('playwright-core');
        } catch (e) {
            throw new Error(`[AI-Visual] Could not resolve Playwright. Ensure Playwright is installed: ${e.message}`);
        }
    }
};

const { chromium } = resolvePlaywright();

// =========================================================================
// 🔑 IN-CODE DEFAULT API KEYS
// =========================================================================
const IN_CODE_API_KEYS = {
    gemini: '',
    openai: '',
    claude: ''
};

const SEVERITY_COLORS = {
    Critical: '#FF0000',
    High:     '#FF4500',
    Medium:   '#FF8C00',
    Low:      '#FFD700'
};

const SEVERITY_BG = {
    Critical: '#ffe5e5',
    High:     '#fff0e5',
    Medium:   '#fff8e5',
    Low:      '#fffff0'
};

const SYSTEM_INSTRUCTION = `You are a Principal Accessibility and UI/UX Quality Assurance Auditor performing EXHAUSTIVE cross-environment visual regression testing with ZERO TOLERANCE for missed differences.

You are comparing two UI screenshots pixel by pixel:
- Image A: Baseline / Stable / Old / Production environment
- Image B: Candidate / New / QA / Staging environment

MANDATORY AUDITING RULES:
1. EXTREME GRANULARITY DIRECTIVE (CRITICAL):
   - ZERO GROUPING ALLOWED. Report EACH INDIVIDUAL visual change as a separate, distinct entry!
   - DO NOT GROUP OR CONSOLIDATE multiple differences under general section names.
   - If 14 table headers changed color, you MUST output 14 separate JSON entries.
   - If 5 buttons changed height or border radius, you MUST output 5 separate JSON entries.
   - You are FORBIDDEN from using plural words like "buttons", "inputs", "headers" to group things together.
   - Aim to output 50 to 100 individual JSON entries. Leave absolutely nothing out.

2. COLOUR & STYLING CHANGES:
   - Tab background, active tab, inactive tab, hover state colours
   - Button colours, border colours, text colours, icon colours
   - Page/section/panel background colour changes
   - Even a slight shade difference MUST be reported as Styling/CSS (Low or Medium severity)

3. BORDER & STROKE CHANGES (EVERY SINGLE ONE):
   - Border thickness changes (e.g. 2px -> 1px, thin -> thick, thick -> thin) = Styling/CSS, Medium severity
   - Border colour changes = Styling/CSS, Low or Medium
   - Border style changes (solid -> dashed, present -> absent, missing top/bottom/left/right border) = Styling/CSS, Medium severity

4. TAB & NAVIGATION CHANGES:
   - Active tab indicator colour, underline, border changes = Styling/CSS, Medium
   - Tab text colour or weight change = Styling/CSS, Low or Medium
   - Tab background colour change = Styling/CSS, Medium
   - Tab spacing or size change = Layout Shift, Medium

5. SPACING, MARGIN & LAYOUT SHIFTS:
   - Padding/margin changes even by 2-4px = Layout Shift, Low
   - Alignment shifts = Layout Shift, Low or Medium
   - Element size (width/height) changes = Layout Shift, Medium

6. TEXT & TYPOGRAPHY CHANGES:
   - Any label, button text, placeholder, tooltip difference = Text Change
   - Font size, weight, line-height, or typography changes = Styling/CSS

7. MISSING OR EXTRA ELEMENTS:
   - Icons, badges, dividers, buttons, links, dropzones = Missing or New Addition

8. CRITICAL MASKING DIRECTIVE:
   - Any area overlaid with bright magenta (#FF00FF / RGB 255,0,255) represents dynamic/volatile data.
   - You MUST completely IGNORE anything covered by bright magenta masks.

BOUNDING BOX COORDINATES:
For EVERY difference, provide approximate location in Image B:
- xPct: Left edge as % of image width (0-100)
- yPct: Top edge as % of image height (0-100)
- wPct: Width of changed region as % of image width (0-100)
- hPct: Height of changed region as % of image height (0-100)

OUTPUT FORMAT:
Return strictly a valid JSON object with:
{
  "hasCriticalDefects": true/false (true if ANY difference is Medium, High or Critical; false ONLY if all are Low or no diffs),
  "differences": [
    {
      "element": "UI component name",
      "issueType": "Missing" | "New Addition" | "Layout Shift" | "Overlap" | "Styling/CSS" | "Text Change",
      "severity": "Low" | "Medium" | "High" | "Critical",
      "description": "Clear explanation of what changed from Baseline to Candidate",
      "boundingBox": { "xPct": 5.0, "yPct": 10.0, "wPct": 12.0, "hPct": 4.0 }
    }
  ]
}`;

function buildUrl(baseUrl, pathOrUrl) {
    if (!baseUrl) return pathOrUrl;
    const cleanBase = baseUrl.trim().replace(/\/+$/, '');
    if (!pathOrUrl) return cleanBase;

    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
        try {
            const parsed = new URL(pathOrUrl);
            return `${cleanBase}${parsed.pathname}${parsed.search}`;
        } catch {
            return pathOrUrl;
        }
    }

    const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${cleanBase}${cleanPath}`;
}

function getProviderForModel(modelName = '') {
    const lower = modelName.toLowerCase();
    if (lower.startsWith('gemini')) return 'gemini';
    if (lower.startsWith('claude')) return 'claude';
    return 'openai';
}

async function compareScreenshotsWithMultiLLM(base64ImageA, base64ImageB, deterministicDiff = {}, modelName = 'gemini-3.8-flash') {
    const provider = getProviderForModel(modelName);

    let apiKey = '';
    if (provider === 'gemini') {
        apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || DEFAULT_API_KEYS.gemini;
    } else if (provider === 'openai') {
        apiKey = process.env.OPENAI_API_KEY || process.env.API_KEY || DEFAULT_API_KEYS.openai;
    } else if (provider === 'claude') {
        apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.API_KEY || DEFAULT_API_KEYS.claude;
    }

    if (!apiKey) {
        throw new Error(`[AI-Visual] ${provider.toUpperCase()} API Key is missing.`);
    }

    const cleanA = base64ImageA.replace(/^data:image\/\w+;base64,/, '');
    const cleanB = base64ImageB.replace(/^data:image\/\w+;base64,/, '');
    const mimeA = cleanA.startsWith('/9j') ? 'image/jpeg' : 'image/png';
    const mimeB = cleanB.startsWith('/9j') ? 'image/jpeg' : 'image/png';

    let domDiffContext = '';
    if (deterministicDiff && (deterministicDiff.added?.length || deterministicDiff.removed?.length || deterministicDiff.modified?.length)) {
        domDiffContext = `\n\n════════════════════════════════════════════════════════\nDETERMINISTIC DOM EXTRACTION DATA\n════════════════════════════════════════════════════════\nWe mathematically extracted exactly what was added, removed, and styled differently over the entire page. EXPLAIN THESE CHANGES:\n\n${JSON.stringify(deterministicDiff, null, 2)}\n\nYou MUST NOT summarize. You MUST explain every single factual change listed above as a separate JSON item.`;
    }

    const userPrompt = `Perform an EXHAUSTIVE visual regression comparison between Image A (Baseline / Stable) and Image B (Candidate / New / QA).

MANDATORY RULES:
1. Scan EVERY individual tab, border, input field, label, header, and button.
2. DO NOT GROUP findings into broad summary cards!
3. ZERO GROUPING ALLOWED. Output 50 to 100+ granular, atomic difference items in the differences array so every single border, thin/thick variation, color shift, and layout change is documented independently.
4. If 5 tabs changed color, list all 5 tabs as 5 independent JSON objects.
5. If a tab or container has a missing border or modified border-width, report it explicitly.${domDiffContext}\n\nProvide structured JSON adhering strictly to the schema. Output at least 50+ granular differences. If you summarize or group items, you have failed the prompt.`;

    console.log(`[AI-Visual] Submitting audit request to ${provider.toUpperCase()} (${modelName})...`);

    // 1. GOOGLE GEMINI
    if (provider === 'gemini') {
        const fallbackModels = [modelName, 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];
        const uniqueModels = [...new Set(fallbackModels)];
        let lastError = null;

        for (const currentModel of uniqueModels) {
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    let responseText = '';
                    try {
                        const { GoogleGenAI } = await import('@google/genai');
                        const ai = new GoogleGenAI({ apiKey });
                        const response = await ai.models.generateContent({
                            model: currentModel,
                            contents: [
                                {
                                    role: 'user',
                                    parts: [
                                        { text: userPrompt },
                                        { inlineData: { mimeType: mimeA, data: cleanA } },
                                        { inlineData: { mimeType: mimeB, data: cleanB } }
                                    ]
                                }
                            ],
                            config: {
                                systemInstruction: SYSTEM_INSTRUCTION,
                                responseMimeType: 'application/json'
                            }
                        });
                        responseText = response.text;
                    } catch (_) {
                        const restUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
                        const restRes = await fetch(restUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [
                                    {
                                        role: 'user',
                                        parts: [
                                            { text: `${SYSTEM_INSTRUCTION}\n\n${userPrompt}` },
                                            { inline_data: { mime_type: mimeA, data: cleanA } },
                                            { inline_data: { mime_type: mimeB, data: cleanB } }
                                        ]
                                    }
                                ],
                                generationConfig: { response_mime_type: 'application/json' }
                            })
                        });

                        if (!restRes.ok) {
                            const errBody = await restRes.text();
                            throw new Error(`Gemini REST HTTP ${restRes.status}: ${errBody}`);
                        }
                        const restJson = await restRes.json();
                        responseText = restJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    }

                    if (!responseText) throw new Error('Empty response received from Gemini.');
                    const cleanJsonStr = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
                    return normalizeReport(JSON.parse(cleanJsonStr));

                } catch (err) {
                    lastError = err;
                    const isRetryable = err.message.includes('503') || err.message.includes('429') || err.message.includes('UNAVAILABLE') || err.message.includes('high demand');
                    if (!isRetryable) break;
                    if (attempt < 3) {
                        const waitTime = attempt * 4000;
                        console.warn(`[Gemini] ${currentModel} busy. Retrying in ${waitTime/1000}s...`);
                        await new Promise(r => setTimeout(r, waitTime));
                    }
                }
            }
        }
        throw new Error(`[Gemini] All fallback models failed. Last error: ${lastError?.message}`);
    }

    // 2. OPENAI (GPT-4o)
    else if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: SYSTEM_INSTRUCTION },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: userPrompt },
                            { type: 'image_url', image_url: { url: `data:${mimeA};base64,${cleanA}` } },
                            { type: 'image_url', image_url: { url: `data:${mimeB};base64,${cleanB}` } }
                        ]
                    }
                ],
                max_tokens: 16000
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenAI HTTP ${response.status}: ${errText}`);
        }
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        return normalizeReport(JSON.parse(content));
    }

    // 3. ANTHROPIC CLAUDE
    else if (provider === 'claude') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: modelName,
                system: SYSTEM_INSTRUCTION,
                max_tokens: 8192,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: `${userPrompt}\n\nIMPORTANT: Respond ONLY with valid raw JSON object.` },
                            { type: 'image', source: { type: 'base64', media_type: mimeA, data: cleanA } },
                            { type: 'image', source: { type: 'base64', media_type: mimeB, data: cleanB } }
                        ]
                    }
                ]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Claude HTTP ${response.status}: ${errText}`);
        }
        const data = await response.json();
        const rawContent = data.content?.[0]?.text || '{}';
        const cleanJsonStr = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        return normalizeReport(JSON.parse(cleanJsonStr));
    }
}

function normalizeReport(rawReport) {
    const report = { hasCriticalDefects: false, differences: [] };

    if (rawReport && Array.isArray(rawReport.differences)) {
        report.differences = rawReport.differences.map(d => ({
            element: d.element || 'Unknown Component',
            issueType: d.issueType || 'Styling/CSS',
            severity: d.severity || 'Medium',
            description: d.description || '',
            boundingBox: d.boundingBox || { xPct: 5, yPct: 5, wPct: 10, hPct: 5 },
            rect: d.rect || null
        }));
    }

    const hasMajorDefects = report.differences.some(d =>
        ['critical', 'high', 'medium'].includes((d.severity || '').toLowerCase())
    );

    report.hasCriticalDefects = (rawReport.hasCriticalDefects !== undefined)
        ? Boolean(rawReport.hasCriticalDefects || hasMajorDefects)
        : hasMajorDefects;

    return report;
}

function generateVisualReportHtml(oldImageBuffer, newImageBuffer, report, deterministicDiff = {}, outputPath = null) {
    const oldBase64 = oldImageBuffer.toString('base64');
    const newBase64 = newImageBuffer.toString('base64');

    const detectMime = (buf) => (buf[0] === 0xFF && buf[1] === 0xD8) ? 'image/jpeg' : 'image/png';
    const oldMime = detectMime(oldImageBuffer);
    const newMime = detectMime(newImageBuffer);

    const oldDataUrl = `data:${oldMime};base64,${oldBase64}`;
    const newDataUrl = `data:${newMime};base64,${newBase64}`;

    const now = new Date().toLocaleString();
    const totalDiffs = report.differences.length;
    const criticalCount = report.differences.filter(d => (d.severity || '').toLowerCase() === 'critical').length;
    const highCount     = report.differences.filter(d => (d.severity || '').toLowerCase() === 'high').length;
    const mediumCount   = report.differences.filter(d => (d.severity || '').toLowerCase() === 'medium').length;
    const lowCount      = report.differences.filter(d => (d.severity || '').toLowerCase() === 'low').length;

    const diffsJson = JSON.stringify(report.differences);

    const tableRows = report.differences.map((diff, i) => {
        const sev = diff.severity || 'Medium';
        const color = SEVERITY_COLORS[sev] || '#888';
        const bg    = SEVERITY_BG[sev]    || '#fff';
        const bb    = diff.boundingBox;
        const bbStr = bb
            ? `x:${bb.xPct?.toFixed(1)}% y:${bb.yPct?.toFixed(1)}% w:${bb.wPct?.toFixed(1)}% h:${bb.hPct?.toFixed(1)}%`
            : (diff.rect ? `[${diff.rect.x}px, ${diff.rect.y}px]` : 'N/A');

        return `
        <tr style="background:${bg};" data-index="${i}" class="diff-row" onclick="highlightDiff(${i})">
            <td style="text-align:center;font-weight:bold;">${i + 1}</td>
            <td><strong>${diff.element || '—'}</strong></td>
            <td><span style="background:${color};color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;">${sev}</span></td>
            <td>${diff.issueType || '—'}</td>
            <td>${diff.description || '—'}</td>
            <td style="font-size:11px;color:#555;font-family:monospace;">${bbStr}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>AI Visual Regression Report — ${now}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif; background: #f8fafc; color: #1e293b; }
  .header { background: linear-gradient(135deg, #0f172a, #1e1b4b); color: #fff; padding: 24px 32px; border-bottom: 3px solid #8b5cf6; }
  .header h1 { font-size: 22px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
  .header .meta { font-size: 13px; color: #cbd5e1; }
  .summary { display: flex; gap: 14px; padding: 20px 32px; flex-wrap: wrap; }
  .stat-card { background: #fff; border-radius: 8px; padding: 14px 20px; min-width: 120px;
               box-shadow: 0 1px 3px rgba(0,0,0,0.06); text-align: center; border: 1px solid #e2e8f0; }
  .stat-card .num { font-size: 28px; font-weight: 700; }
  .stat-card .lbl { font-size: 11px; color: #64748b; margin-top: 4px; text-transform: uppercase; font-weight: 600; }
  .stat-card.total  .num { color: #0f172a; }
  .stat-card.crit   .num { color: #ef4444; }
  .stat-card.high   .num { color: #f97316; }
  .stat-card.medium .num { color: #f59e0b; }
  .stat-card.low    .num { color: #84cc16; }
  .badge-pass { background: #10b981; color: #fff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; }
  .badge-fail { background: #ef4444; color: #fff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; }
  .images-section { padding: 0 32px 24px; }
  .images-section h2 { font-size: 16px; margin-bottom: 12px; color: #0f172a; }
  .images-grid { display: flex; gap: 16px; flex-wrap: wrap; }
  .image-card { flex: 1; min-width: 380px; background: #fff; border-radius: 8px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.06); padding: 14px; border: 1px solid #e2e8f0; }
  .image-card h3 { font-size: 13px; color: #334155; margin-bottom: 10px; font-weight: 600; }
  .canvas-wrapper { position: relative; width: 100%; overflow: hidden; background: #000; border-radius: 4px; }
  canvas { width: 100%; height: auto; display: block; }
  .table-section { padding: 0 32px 40px; }
  .table-section h2 { font-size: 16px; margin-bottom: 12px; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #e2e8f0; }
  th { background: #0f172a; color: #fff; padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; }
  td { padding: 10px 12px; font-size: 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  .diff-row { cursor: pointer; transition: filter 0.15s; }
  .diff-row:hover { filter: brightness(0.96); }
  .diff-row.active { outline: 3px solid #8b5cf6; }
  footer { text-align: center; padding: 24px; color: #94a3b8; font-size: 11px; }
</style>
</head>
<body>
<div class="header">
  <h1>🔍 AI Visual Regression Audit Report</h1>
  <div class="meta">Generated: ${now} &nbsp;|&nbsp; Multi-LLM Visual Engine &nbsp;|&nbsp;
    Status: ${report.hasCriticalDefects
        ? '<span class="badge-fail">❌ REGRESSIONS DETECTED</span>'
        : '<span class="badge-pass">✅ PASSED</span>'}
  </div>
</div>

<div class="summary">
  <div class="stat-card total"><div class="num">${totalDiffs}</div><div class="lbl">Total Differences</div></div>
  <div class="stat-card crit"><div class="num">${criticalCount}</div><div class="lbl">Critical</div></div>
  <div class="stat-card high"><div class="num">${highCount}</div><div class="lbl">High</div></div>
  <div class="stat-card medium"><div class="num">${mediumCount}</div><div class="lbl">Medium</div></div>
  <div class="stat-card low"><div class="num">${lowCount}</div><div class="lbl">Low</div></div>
</div>

<div class="images-section">
  <h2>📸 Annotated Screenshots (Click any row in the table below to highlight that defect)</h2>
  <div class="images-grid">
    <div class="image-card">
      <h3>🟦 Baseline (Old / Production Environment)</h3>
      <div class="canvas-wrapper"><canvas id="canvasOld"></canvas></div>
    </div>
    <div class="image-card">
      <h3>🟥 Candidate (New / QA Environment)</h3>
      <div class="canvas-wrapper"><canvas id="canvasNew"></canvas></div>
    </div>
  </div>
</div>

<div class="table-section">
  <h2>📋 Detected Differences (${totalDiffs} items)</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 40px; text-align: center;">#</th>
        <th>Component / Element</th>
        <th style="width: 90px;">Severity</th>
        <th style="width: 120px;">Issue Type</th>
        <th>Description</th>
        <th style="width: 170px;">Location (% / Px)</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">No visual differences detected.</td></tr>'}
    </tbody>
  </table>
</div>

<footer>Self-Contained Cross-Environment AI Visual Regression Testing Module &bull; Playwright + Multi-LLM Vision</footer>

<script>
const DIFFS = ${diffsJson};
const COLORS = { Critical: '#FF0000', High: '#FF4500', Medium: '#FF8C00', Low: '#FFD700' };
const imgOldSrc = '${oldDataUrl}';
const imgNewSrc = '${newDataUrl}';

let imgOld = new Image();
let imgNew = new Image();
let canvasOld = document.getElementById('canvasOld');
let canvasNew = document.getElementById('canvasNew');
let ctxOld = canvasOld.getContext('2d');
let ctxNew = canvasNew.getContext('2d');

let activeIndex = null;

function drawAnnotations(ctx, canvas, img, activeDiffIndex) {
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  DIFFS.forEach((diff, i) => {
    let x, y, w, h;
    if (diff.boundingBox) {
      const bb = diff.boundingBox;
      x = (bb.xPct / 100) * canvas.width;
      y = (bb.yPct / 100) * canvas.height;
      w = (bb.wPct / 100) * canvas.width;
      h = (bb.hPct / 100) * canvas.height;
    } else if (diff.rect) {
      x = diff.rect.x; y = diff.rect.y; w = diff.rect.w || 100; h = diff.rect.h || 40;
    } else return;

    const color = COLORS[diff.severity] || '#FF0000';
    const isActive = (i === activeDiffIndex);

    ctx.strokeStyle = color;
    ctx.lineWidth   = isActive ? 6 : 3;
    ctx.setLineDash(isActive ? [] : [6, 4]);
    ctx.strokeRect(x, y, w, h);

    if (isActive) {
      ctx.fillStyle = color + '33';
      ctx.fillRect(x, y, w, h);
    }

    const label = '#' + (i + 1) + ' ' + (diff.severity || '');
    const fontSize = Math.max(14, Math.min(24, Math.round(canvas.width / 70)));
    ctx.font = 'bold ' + fontSize + 'px sans-serif';
    const textW = ctx.measureText(label).width + 12;
    ctx.fillStyle = color;
    ctx.fillRect(x, y - fontSize - 6, textW, fontSize + 8);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 6, y - 6);
  });
}

function redraw(activeIdx) {
  drawAnnotations(ctxOld, canvasOld, imgOld, activeIdx);
  drawAnnotations(ctxNew, canvasNew, imgNew, activeIdx);
}

function highlightDiff(idx) {
  activeIndex = (activeIndex === idx) ? null : idx;
  document.querySelectorAll('.diff-row').forEach((r, i) => {
    r.classList.toggle('active', i === activeIndex);
  });
  redraw(activeIndex);
}

let loadedCount = 0;
function onLoad() {
  loadedCount++;
  if (loadedCount === 2) redraw(null);
}
imgOld.onload = onLoad;
imgNew.onload = onLoad;
imgOld.src = imgOldSrc;
imgNew.src = imgNewSrc;
</script>
</body>
</html>`;

    if (outputPath) {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, html, 'utf-8');
        console.log(`[AI-Visual] HTML report written to: ${outputPath}`);
    }

    return html;
}

// =========================================================================
// 🚀 STANDALONE RUNNER MAIN FUNCTION
// =========================================================================
async function run() {
    const oldEnv = {
        baseUrl: process.env.OLD_BASE_URL,
        loginName: process.env.OLD_LOGIN_NAME,
        loginPath: process.env.OLD_LOGIN_PATH,
        password: process.env.OLD_PASSWORD
    };

    const newEnv = {
        baseUrl: process.env.NEW_BASE_URL,
        loginName: process.env.NEW_LOGIN_NAME,
        loginPath: process.env.NEW_LOGIN_PATH,
        password: process.env.NEW_PASSWORD
    };

    const oldTargetModulePath = process.env.OLD_TARGET_PAGE || process.env.TARGET_PAGE;
    const newTargetModulePath = process.env.NEW_TARGET_PAGE || process.env.TARGET_PAGE;

    if (!oldEnv.baseUrl || !newEnv.baseUrl || !oldTargetModulePath || !newTargetModulePath) {
        console.error('[AI-Visual Fatal Error]: Missing required environment variables (OLD_BASE_URL, NEW_BASE_URL, TARGET_PAGE).');
        process.exit(1);
    }
    const aiModel = process.env.AI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const headed = process.env.HEADED === 'true';

    console.log(`[AI-Visual] Launching standalone visual engine with model: ${aiModel}`);
    console.log(`[AI-Visual] Baseline:  ${oldEnv.baseUrl}`);
    console.log(`[AI-Visual] Candidate: ${newEnv.baseUrl}`);

    const viewport = { width: 1920, height: 1080 };
    const oldUserDataDir = path.join(__dirname, '.auth', 'baseline');
    const newUserDataDir = path.join(__dirname, '.auth', 'candidate');

    const oldContext = await chromium.launchPersistentContext(oldUserDataDir, { headless: !headed, viewport });
    const newContext = await chromium.launchPersistentContext(newUserDataDir, { headless: !headed, viewport });

    const oldPage = oldContext.pages()[0] || await oldContext.newPage();
    const newPage = newContext.pages()[0] || await newContext.newPage();

    const performLogin = async (page, env) => {
        if (!env.loginName || !env.password) {
            console.log(`[AI-Visual] No credentials provided for ${env.baseUrl}. Skipping login phase.`);
            return;
        }

        const resolvedLoginPath = env.loginPath && env.loginPath.trim() !== '' ? env.loginPath : '/';
        const loginUrl = buildUrl(env.baseUrl, resolvedLoginPath);
        
        console.log(`[AI-Visual] Navigating to login page: ${loginUrl}`);
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

        const clickBtn = async (name) => {
            const locator = page.locator('input, a, button').locator('visible=true').getByText(name, { exact: true }).first();
            if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
                await locator.click();
                return true;
            }
            const fallback = page.getByRole('button', { name, exact: false }).first();
            if (await fallback.isVisible({ timeout: 2000 }).catch(() => false)) {
                await fallback.click();
                return true;
            }
            const inputBtn = page.locator(`input[type="button"][value*="${name}" i], input[type="submit"][value*="${name}" i]`).first();
            if (await inputBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await inputBtn.click();
                return true;
            }
            return false;
        };

        // Specific Login (e.g. Swag Labs / SauceDemo style)
        const specificLogin = page.locator('#user-name, [data-test="username"]').first();
        if (await specificLogin.isVisible({ timeout: 4000 }).catch(() => false)) {
            console.log(`[AI-Visual] Logging in to ${env.baseUrl} (User: ${env.loginName})...`);
            await specificLogin.fill(env.loginName);
            const specificPass = page.locator('#password, [data-test="password"]').first();
            if (await specificPass.isVisible().catch(() => false)) {
                await specificPass.fill(env.password);
            }
            const specificBtn = page.locator('#login-button, [data-test="login-button"]').first();
            if (await specificBtn.isVisible().catch(() => false)) {
                await specificBtn.click();
            }
            console.log(`[AI-Visual] Successfully submitted credentials on ${env.baseUrl}`);
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(2000); // Give extra buffer for cookies to set before leaving
            return;
        }

        // Generic 1-Step Form Fallback (for standard web applications)
        const genericLogin = page.locator('input[name*="user" i], input[name*="login" i], input[type="email"]').first();
        if (await genericLogin.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log(`[AI-Visual] Attempting generic login on ${env.baseUrl}...`);
            await genericLogin.fill(env.loginName);
            const genericPass = page.locator('input[type="password"]').first();
            if (await genericPass.isVisible().catch(() => false)) {
                await genericPass.fill(env.password);
                await clickBtn('Sign In') || await clickBtn('Log In') || await clickBtn('Submit');
                await page.waitForLoadState('networkidle').catch(() => {});
                await page.waitForTimeout(2000); // Give extra buffer for cookies to set before leaving
            }
        }
    };

    try {
        console.log('[AI-Visual] Concurrently navigating Baseline and Candidate environments...');
        await Promise.all([
            (async () => {
                await performLogin(oldPage, oldEnv);
                const fullTargetUrl = buildUrl(oldEnv.baseUrl, oldTargetModulePath);
                console.log(`[AI-Visual] Navigating Baseline to target: ${fullTargetUrl}`);
                await oldPage.goto(fullTargetUrl, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
                await oldPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await oldPage.waitForTimeout(2500);
            })(),

            (async () => {
                await performLogin(newPage, newEnv);
                const fullTargetUrl = buildUrl(newEnv.baseUrl, newTargetModulePath);
                console.log(`[AI-Visual] Navigating Candidate to target: ${fullTargetUrl}`);
                await newPage.goto(fullTargetUrl, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
                await newPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await newPage.waitForTimeout(2500);
            })()
        ]);

        const maskSelectors = ['.live-clock', '.dynamic-data', '#serverTime', '.session-info', '.last-login-info'];
        const maskLocatorsOld = maskSelectors.map(sel => oldPage.locator(sel));
        const maskLocatorsNew = maskSelectors.map(sel => newPage.locator(sel));

        console.log('[AI-Visual] Extracting deterministic DOM & CSS metrics...');
        const extractDOMData = async (page) => {
            return await page.evaluate(() => {
                const results = {};
                
                // Recursive function to deeply traverse the DOM and extract EVERY meaningful node
                const traverse = (node, path = '') => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    
                    // Skip invisible elements early to save processing
                    const rect = node.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) return;
                    
                    // Skip script, style, and meta tags as they are not visual UI elements
                    const tag = node.tagName.toLowerCase();
                    if (['script', 'style', 'meta', 'link', 'noscript', 'head'].includes(tag)) return;

                    // Extract multiple identifiers to build a robust key for ANY element
                    let text = node.innerText?.trim().replace(/\n/g, ' ').substring(0, 50);
                    if (!text && node.placeholder) text = node.placeholder.substring(0, 50);
                    if (!text && node.value) text = node.value.substring(0, 50);
                    if (!text && node.getAttribute('aria-label')) text = node.getAttribute('aria-label').substring(0, 50);
                    if (!text && node.getAttribute('title')) text = node.getAttribute('title').substring(0, 50);
                    
                    // If we still have no text, use ID or distinct classes as the identifier
                    const idStr = node.id ? `#${node.id}` : '';
                    const classStr = (typeof node.className === 'string' && node.className) ? `.${node.className.split(' ').join('.')}` : '';
                    const fallbackId = text ? '' : (idStr || classStr || path);

                    // Only capture elements that have some identifiable feature (text, id, or classes) or are standalone leaf nodes
                    if (text || idStr || classStr || node.children.length === 0) {
                        const key = `${tag} [Text/ID: "${text || fallbackId}"]`;

                        // Only grab the first occurrence to avoid list explosion
                        if (!results[key]) {
                            const computed = window.getComputedStyle(node);
                            
                            results[key] = {
                                tag: tag,
                                text: text,
                                classes: typeof node.className === 'string' ? node.className : '',
                                rect: {
                                    x: Math.round(rect.x + window.scrollX),
                                    y: Math.round(rect.y + window.scrollY),
                                    w: Math.round(rect.width),
                                    h: Math.round(rect.height)
                                },
                                css: {
                                    color: computed.color,
                                    bgColor: computed.backgroundColor,
                                    borderColor: computed.borderColor,
                                    borderWidth: computed.borderWidth,
                                    borderRadius: computed.borderRadius,
                                    boxShadow: computed.boxShadow,
                                    fontSize: computed.fontSize,
                                    padding: computed.padding,
                                    margin: computed.margin,
                                    display: computed.display,
                                    visibility: computed.visibility,
                                    opacity: computed.opacity
                                }
                            };
                        }
                    }

                    // Recursively process children to build a structural path
                    const children = Array.from(node.children);
                    for (let i = 0; i < children.length; i++) {
                        traverse(children[i], `${path}>${children[i].tagName.toLowerCase()}:nth-child(${i+1})`);
                    }
                };

                traverse(document.body);
                return results;
            });
        };

        const [oldDOM, newDOM] = await Promise.all([extractDOMData(oldPage), extractDOMData(newPage)]);

        const deterministicDiff = {
            added: [],
            removed: [],
            modified: []
        };

        const allKeys = new Set([...Object.keys(oldDOM), ...Object.keys(newDOM)]);
        
        // First pass: Find exact matches
        allKeys.forEach(key => {
            const oldEl = oldDOM[key];
            const newEl = newDOM[key];

            if (!oldEl && newEl) {
                deterministicDiff.added.push({ element: key, details: newEl });
            } else if (oldEl && !newEl) {
                deterministicDiff.removed.push({ element: key, details: oldEl });
            } else if (oldEl && newEl) {
                const changes = [];
                
                // CSS Diff
                for (const prop in oldEl.css) {
                    if (oldEl.css[prop] !== newEl.css[prop]) {
                        changes.push(`CSS ${prop} changed from '${oldEl.css[prop]}' to '${newEl.css[prop]}'`);
                    }
                }

                // Layout Diff
                if (Math.abs(oldEl.rect.x - newEl.rect.x) > 3) changes.push(`X shifted from ${oldEl.rect.x} to ${newEl.rect.x}`);
                if (Math.abs(oldEl.rect.y - newEl.rect.y) > 3) changes.push(`Y shifted from ${oldEl.rect.y} to ${newEl.rect.y}`);
                if (Math.abs(oldEl.rect.w - newEl.rect.w) > 3) changes.push(`Width changed from ${oldEl.rect.w} to ${newEl.rect.w}`);
                if (Math.abs(oldEl.rect.h - newEl.rect.h) > 3) changes.push(`Height changed from ${oldEl.rect.h} to ${newEl.rect.h}`);
                
                if (changes.length > 0) {
                    deterministicDiff.modified.push({ 
                        element: key, 
                        changes: changes, 
                        rect: newEl.rect 
                    });
                }
            }
        });

        // Second pass: Heuristic matching for renamed/restructured elements
        for (let i = deterministicDiff.removed.length - 1; i >= 0; i--) {
            const removedEl = deterministicDiff.removed[i];
            for (let j = deterministicDiff.added.length - 1; j >= 0; j--) {
                const addedEl = deterministicDiff.added[j];
                
                // If they are the same tag and exist in roughly the same spatial area (within 50px)
                const sameTag = removedEl.details.tag === addedEl.details.tag;
                const spatialMatch = Math.abs(removedEl.details.rect.x - addedEl.details.rect.x) < 50 && 
                                     Math.abs(removedEl.details.rect.y - addedEl.details.rect.y) < 50;

                if (sameTag && spatialMatch) {
                    // It's likely the same element that just had its text/ID changed
                    deterministicDiff.modified.push({
                        element: `Element at [x:${addedEl.details.rect.x}, y:${addedEl.details.rect.y}]`,
                        changes: [
                            `Identifier changed from '${removedEl.element}' to '${addedEl.element}'`,
                            `Text content changed from '${removedEl.details.text}' to '${addedEl.details.text}'`
                        ],
                        rect: addedEl.details.rect
                    });
                    
                    deterministicDiff.removed.splice(i, 1);
                    deterministicDiff.added.splice(j, 1);
                    break;
                }
            }
        }

        console.log('[AI-Visual] Capturing masked full-page screenshots in both environments...');
        const [oldPngBuffer, newPngBuffer] = await Promise.all([
            oldPage.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', mask: maskLocatorsOld, maskColor: '#FF00FF' }),
            newPage.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', mask: maskLocatorsNew, maskColor: '#FF00FF' })
        ]);

        const [oldJpegBuffer, newJpegBuffer] = await Promise.all([
            oldPage.screenshot({ fullPage: true, scale: 'css', type: 'jpeg', quality: 60, mask: maskLocatorsOld, maskColor: '#FF00FF' }),
            newPage.screenshot({ fullPage: true, scale: 'css', type: 'jpeg', quality: 60, mask: maskLocatorsNew, maskColor: '#FF00FF' })
        ]);

        // Save raw screenshots to test-results/
        const resultsDir = path.resolve(workspaceRoot, 'test-results');
        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

        fs.writeFileSync(path.join(resultsDir, 'Baseline-Old-Environment.png'), oldPngBuffer);
        fs.writeFileSync(path.join(resultsDir, 'Candidate-New-Environment.png'), newPngBuffer);

        const base64Old = oldJpegBuffer.toString('base64');
        const base64New = newJpegBuffer.toString('base64');

        const report = await compareScreenshotsWithMultiLLM(base64Old, base64New, deterministicDiff, aiModel);

        const htmlReportPath = path.join(resultsDir, 'ai-visual-report.html');
        const jsonReportPath = path.join(resultsDir, 'ai-report.json');

        generateVisualReportHtml(oldPngBuffer, newPngBuffer, report, deterministicDiff, htmlReportPath);
        fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2), 'utf-8');

        console.log('\n================ AI VISUAL REGRESSION AUDIT REPORT ================');
        console.log(`Model: ${aiModel}`);
        console.log(`Has Critical Defects (Medium+): ${report.hasCriticalDefects}`);
        console.log(`Total Differences Found: ${report.differences.length}`);
        const sevCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
        report.differences.forEach((diff, idx) => {
            sevCounts[diff.severity] = (sevCounts[diff.severity] || 0) + 1;
            const bb = diff.boundingBox ? ` [x:${diff.boundingBox.xPct?.toFixed(0)}%, y:${diff.boundingBox.yPct?.toFixed(0)}%]` : '';
            console.log(` [${idx + 1}] [${diff.severity.toUpperCase()}] [${diff.issueType}] ${diff.element}${bb}\n      → ${diff.description}`);
        });
        console.log(`\nSeverity Breakdown: Critical=${sevCounts.Critical} High=${sevCounts.High} Medium=${sevCounts.Medium} Low=${sevCounts.Low}`);
        console.log(`📊 HTML Report: file://${htmlReportPath}`);
        console.log('===================================================================\n');

        if (report.hasCriticalDefects) {
            process.exitCode = 1;
        } else {
            process.exitCode = 0;
        }

    } finally {
        await oldPage.close().catch(() => {});
        await newPage.close().catch(() => {});
        await oldContext.close().catch(() => {});
        await newContext.close().catch(() => {});
    }
}

run().catch((err) => {
    console.error(`\n[AI-Visual Fatal Error]: ${err.message}\n${err.stack}`);
    process.exit(1);
});

