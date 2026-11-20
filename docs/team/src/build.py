"""Build the team PDFs: Markdown -> HTML -> PDF (headless Chrome or Edge).
Run from this folder with a Python that has `markdown` installed:
  python -I build.py [chrome-executable]
The executable can also be set in the CHROME environment variable."""
import os, re, subprocess, sys, shutil, pathlib, tempfile
import markdown

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent
DOCS = [  # file, title, orientation, footer label
    ("01-selah-handbook", "Selah Team Handbook", "portrait", "Selah team handbook"),
    ("02-selah-workflows", "Selah Workflows", "portrait", "Selah workflows"),
    ("03-selah-production-path", "Selah Production Path", "landscape", "Selah production path"),
]
AR = re.compile(r"[\u0600-\u06FF\u0750-\u077F](?:[\u0600-\u06FF\u0750-\u077F\u200f«»\- ]*[\u0600-\u06FF\u0750-\u077F»])?")

def wrap_arabic(html):
    parts = re.split(r"(<[^>]+>)", html)
    out = []
    for p in parts:
        if p.startswith("<"):
            out.append(p)
        else:
            out.append(AR.sub(lambda m: f'<span class="ar" dir="rtl" lang="ar">{m.group(0)}</span>', p))
    return "".join(out)

def flows(text):
    def rep(m):
        rows = []
        for line in m.group(1).strip().splitlines():
            items = [i.strip() for i in line.split(">")]
            h = []
            for i, it in enumerate(items):
                cls = "step"
                if it.startswith("@"):
                    cls += " who"; it = it[1:].strip()
                if it.startswith("~"):
                    cls += " dash"; it = it[1:].strip()
                h.append(f'<div class="{cls}">{it}</div>')
                if i < len(items) - 1:
                    h.append('<div class="arr">&rarr;</div>')
            rows.append('<div class="flow">' + "".join(h) + "</div>")
        return "\n\n" + "\n".join(rows) + "\n\n"
    return re.sub(r"```flow\n(.*?)```", rep, text, flags=re.S)

def chrome_path():
    if len(sys.argv) > 1: return sys.argv[1]
    if os.environ.get("CHROME"): return os.environ["CHROME"]
    for c in ("chrome", "google-chrome", "msedge", "chromium"):
        w = shutil.which(c)
        if w: return w
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(c): return c
    sys.exit("No Chrome or Edge found: pass its path as the first argument.")

css = (HERE / "style.css").read_text(encoding="utf8")
for name, title, orient, label in DOCS:
    md = flows((HERE / f"{name}.md").read_text(encoding="utf8"))
    body = markdown.markdown(md, extensions=["tables", "attr_list", "md_in_html", "sane_lists"])
    body = wrap_arabic(body)
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<style>{css}
@page{{size:A4 {orient};margin:15mm 15mm 17mm 15mm;
 @bottom-left{{content:"{label}";font:7.5pt 'Segoe UI',sans-serif;color:#777}}
 @bottom-right{{content:counter(page) " / " counter(pages);font:7.5pt 'Segoe UI',sans-serif;color:#777}}}}
</style></head><body>{body}</body></html>"""
    html_path = HERE / f"{name}.html"
    html_path.write_text(page, encoding="utf8")
    pdf = OUT / f"{name}.pdf"
    subprocess.run([chrome_path(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--user-data-dir={tempfile.mkdtemp()}",
                    f"--print-to-pdf={pdf}", html_path.as_uri()], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    print("wrote", pdf.name)
