// Cuts a region out of a screenshot for a closer look: node crop.mjs <in> <out> x y w h [scale]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const [src, out, x, y, w, h, scale = "2"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(w) * Number(scale), height: Number(h) * Number(scale) } });
const data = readFileSync(src).toString("base64");
await p.setContent(`<body style="margin:0;overflow:hidden"><img src="data:image/png;base64,${data}" style="position:absolute;left:${-x * scale}px;top:${-y * scale}px;transform-origin:0 0;transform:scale(${scale})"></body>`);
await p.screenshot({ path: out });
await b.close();
