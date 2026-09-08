"""Build standalone client-side stlite webapp (index.html)."""
import json
from pathlib import Path


def build():
    current_dir = Path(__file__).resolve().parent
    local_svr = current_dir / "svr_roughness"
    parent_svr = current_dir.parent / "svr-roughness" / "src" / "svr_roughness"

    if parent_svr.exists():
        # Keep local vendor directory updated from core source
        local_svr.mkdir(parents=True, exist_ok=True)
        for py_file in parent_svr.glob("*.py"):
            if py_file.name != "native.py":
                (local_svr / py_file.name).write_text(py_file.read_text(encoding="utf-8"), encoding="utf-8")
        svr_dir = local_svr
    elif local_svr.exists():
        svr_dir = local_svr
    else:
        raise FileNotFoundError(f"svr_roughness not found in {local_svr} or {parent_svr}")

    files = {}
    for py_file in sorted(svr_dir.glob("*.py")):
        if py_file.name == "native.py":
            continue
        files[f"svr_roughness/{py_file.name}"] = py_file.read_text(encoding="utf-8")

    app_code = (current_dir / "app.py").read_text(encoding="utf-8")
    files["app.py"] = app_code

    # Safely escape '<' as unicode escape so JSON inside <script> can never break HTML parsing
    files_json = json.dumps(files).replace("<", "\\u003c")

    html_content = f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <title>S_VR Surface Roughness Metrology | ASTM WK92969</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@stlite/browser@1.8.1/build/stlite.css" />
    <style>
      html, body, #root {{
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background-color: #0e1117;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #f1f5f9;
      }}
      #loading-container {{
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background-color: #0e1117;
        z-index: 99999;
        transition: opacity 0.3s ease;
      }}
      .loading-card {{
        background: #1a1f2c;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 2.2rem 2.5rem;
        max-width: 480px;
        width: 90%;
        text-align: center;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
      }}
      .loading-title {{
        font-size: 1.25rem;
        font-weight: 700;
        margin-bottom: 0.35rem;
        color: #f8fafc;
        letter-spacing: -0.01em;
      }}
      .loading-sub {{
        font-size: 0.84rem;
        color: #94a3b8;
        margin-bottom: 1.5rem;
      }}
      .spinner {{
        width: 42px;
        height: 42px;
        border: 3.5px solid rgba(56, 189, 248, 0.2);
        border-top-color: #38bdf8;
        border-radius: 50%;
        animation: spin 0.85s linear infinite;
        margin: 0 auto 1.25rem auto;
      }}
      @keyframes spin {{
        to {{ transform: rotate(360deg); }}
      }}
      .loading-status {{
        font-size: 0.88rem;
        font-weight: 500;
        color: #38bdf8;
        margin-bottom: 0.45rem;
      }}
      .loading-desc {{
        font-size: 0.78rem;
        color: #64748b;
        line-height: 1.4;
      }}
      #error-box {{
        display: none;
        margin-top: 1.1rem;
        padding: 0.85rem;
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.4);
        border-radius: 6px;
        color: #fca5a5;
        font-size: 0.8rem;
        text-align: left;
        font-family: monospace;
        white-space: pre-wrap;
        word-break: break-word;
      }}
    </style>
  </head>
  <body>
    <div id="loading-container">
      <div class="loading-card">
        <div class="spinner" id="loading-spinner"></div>
        <div class="loading-title">S<sub>VR</sub> Roughness Metrology</div>
        <div class="loading-sub">ASTM WK92969 &bull; Pure-Python Client-Side WebAssembly</div>
        <div class="loading-status" id="loading-status">Loading Pyodide WASM runtime...</div>
        <div class="loading-desc" id="loading-desc">
          Loading lightweight in-browser scientific runtime (NumPy).
          Assets are cached by your browser for instant subsequent starts.
        </div>
        <div id="error-box"></div>
      </div>
    </div>

    <div id="root"></div>

    <script id="stlite-files" type="application/json">{files_json}</script>

    <script>
      window.addEventListener('error', function(e) {{
        var eb = document.getElementById('error-box');
        var ls = document.getElementById('loading-status');
        if (eb) {{
          eb.style.display = 'block';
          eb.textContent = 'Startup error: ' + (e.message || e.error || e);
        }}
        if (ls) {{
          ls.style.color = '#ef4444';
          ls.textContent = 'Runtime initialization failed.';
        }}
      }});
    </script>

    <script type="module">
      import {{ mount }} from "https://cdn.jsdelivr.net/npm/@stlite/browser@1.8.1/build/stlite.js";

      const files = JSON.parse(document.getElementById("stlite-files").textContent);

      mount(
        {{
          entrypoint: "app.py",
          files: files,
          requirements: ["numpy"],
          streamlitConfig: {{
            "client.toolbarMode": "minimal",
            "theme.base": "dark",
            "theme.primaryColor": "#38bdf8",
            "theme.backgroundColor": "#0e1117",
            "theme.secondaryBackgroundColor": "#1a1f2c",
            "theme.textColor": "#f1f5f9"
          }}
        }},
        document.getElementById("root")
      );

      // Hide loading screen once Streamlit renders its first DOM element
      const observer = new MutationObserver(() => {{
        const appElem = document.querySelector('#root .stApp') || document.querySelector('#root [data-testid="stAppViewContainer"]');
        if (appElem) {{
          const loader = document.getElementById('loading-container');
          if (loader) {{
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 320);
          }}
          observer.disconnect();
        }}
      }});
      observer.observe(document.getElementById('root'), {{ childList: true, subtree: true }});
    </script>
  </body>
</html>
"""
    out_html = current_dir / "index.html"
    out_html.write_text(html_content, encoding="utf-8")
    print(f"Wrote {out_html} ({out_html.stat().st_size:,} bytes)")


if __name__ == "__main__":
    build()
