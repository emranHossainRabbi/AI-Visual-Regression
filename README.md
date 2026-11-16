# AI Visual Regression Runner & Analyzer

A powerful VS Code extension for cross-environment visual regression testing powered by **Playwright** and **Multi-LLM Vision AI** (Google Gemini, OpenAI GPT-4o, Anthropic Claude).

Detect subtle semantic visual defects, layout shifts, CSS breakages, missing elements, and unexpected alterations between your Baseline (Stable) and Candidate (QA/New) environments autonomously.

---

## ✨ Key Features

- **Multi-LLM Vision Engine:** Seamlessly switch between Google Gemini, OpenAI GPT-4o, and Anthropic Claude 3.5 Sonnet for visual analysis and defect detection.
- **Persistent Authentication Sessions:** Uses Playwright's `launchPersistentContext` to retain cookies, local storage, and session state. Log in once, and subsequent tests run instantly without re-authenticating.
- **Dynamic & Generic Login Handling:** Fully configurable login paths and intelligent DOM querying to automatically handle standard web application login forms (username, password, submit) without hardcoded selectors.
- **Side-by-Side Cross-Environment Testing:** Concurrently navigates both environments (Old vs New) to the target module, applies bright magenta masks (`#FF00FF`) over volatile dynamic data (live clocks, timestamps), and captures full-page high-resolution screenshots.
- **Hybrid DOM & Vision Analysis:** Extracts deterministic DOM, CSS, and bounding box metrics alongside screenshots for maximum AI sensitivity.
- **Interactive Sidebar GUI with State Persistence:** Configure URLs, credentials, login paths, and AI models directly within VS Code. Input values are auto-saved to workspace state so you never lose your configuration.
- **Rich In-Editor HTML Reports:** Opens comprehensive, side-by-side interactive canvas reports right inside VS Code tabs. Pinpoints differences with bounding boxes and severity breakdowns (Critical, High, Medium, Low).

---

## 🚀 Getting Started

1. Click the **AI Visual Regression** (🔍) icon in the VS Code Activity Bar.
2. Provide your **API Keys** (Gemini, OpenAI, or Claude) in the AI Model & Provider section.
3. Configure your **Baseline (Old/Stable)** and **Candidate (New/QA)** details:
   - **Base URL:** The root URL of your application (e.g., `https://production.env.com`).
   - **Credentials:** Your login name and password.
   - **Login Path (Optional):** The specific path to your login page (e.g., `/login`). Leave blank if the login is on the homepage.
   - **Target Page:** The specific route or module you want to visually test (e.g., `/dashboard`).
4. Click **▶ Run Visual Regression Test**.
5. When complete, view the results in the dashboard or click **📊 Open HTML Report**.

---

## ⚙️ Extension Settings

This extension contributes the following settings globally:

* `aiVisualRunner.geminiApiKey`: Google Gemini API Key.
* `aiVisualRunner.openaiApiKey`: OpenAI API Key.
* `aiVisualRunner.claudeApiKey`: Anthropic Claude API Key.
* `aiVisualRunner.geminiModel`: Default Vision model (e.g., `gemini-3.8-flash`, `gpt-4o`, `claude-3-5-sonnet-20241022`).
* `aiVisualRunner.headed`: Run browsers in visible (headed) mode for debugging.

---

## 👤 Author

**Emran Hossain Rabbi**  
Principal SDET Architect