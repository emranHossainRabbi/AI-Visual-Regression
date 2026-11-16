# Installation Guide

Follow these steps to install the **AI Visual Regression Runner** extension in Visual Studio Code (or Cursor).

## Prerequisites

- **Visual Studio Code** (Version 1.80.0 or higher) or **Cursor** IDE.
- An API Key from at least one supported AI Provider:
  - Google Gemini
  - OpenAI
  - Anthropic (Claude)

## Installation Steps

1. **Locate the VSIX File**
   Ensure you have the packaged extension file: `ai-visual-runner-1.0.0.vsix`.

2. **Open Extensions View in VS Code**
   - Open Visual Studio Code.
   - Go to the **Extensions** view by clicking on the Extensions icon in the Activity Bar on the side of the window.
   - Alternatively, use the keyboard shortcut:
     - **Windows/Linux:** `Ctrl+Shift+X`
     - **macOS:** `Cmd+Shift+X`

3. **Install from VSIX**
   - At the top of the Extensions view, click on the **`...` (Views and More Actions)** menu icon.
   - Select **Install from VSIX...** from the dropdown menu.
   - A file explorer window will open. Navigate to the folder containing `ai-visual-runner-1.0.0.vsix`.
   - Select the file and click **Install**.

4. **Verify Installation**
   - Once installed, you will see a small notification in the bottom right corner: *"Completed installing ai-visual-runner extension from VSIX"*.
   - A new icon (🔍 AI Visual Regression) should now be visible in your Activity Bar (the far-left vertical sidebar).

## Initial Setup

1. Click on the 🔍 **AI Visual Regression** icon in the Activity Bar to open the extension panel.
2. Scroll down to the **🤖 AI Model & Provider** section.
3. Select your preferred AI Model from the dropdown (e.g., `gemini-3.8-flash`).
4. Paste your API Key into the **API Key** input field.
5. Click the **💾 (Save)** button next to the API Key field to save it securely to your global settings.

You are now ready to enter your Baseline/Candidate URLs and run your first visual regression test!