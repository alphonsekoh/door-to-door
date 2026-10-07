import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Renders public/icon.svg into the PNG sizes the manifest and iOS need.
 * Re-run (`npm run icons`) after editing the SVG; the PNGs are committed so a
 * build never depends on a browser being installed.
 */

const PUBLIC = join(process.cwd(), "public");
const svg = readFileSync(join(PUBLIC, "icon.svg"), "utf8");

const OUTPUTS = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
] as const;

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    for (const [file, size] of OUTPUTS) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0}svg{display:block;width:${String(size)}px;height:${String(size)}px}</style>${svg}`,
      );
      await page.screenshot({
        path: join(PUBLIC, file),
        clip: { x: 0, y: 0, width: size, height: size },
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
