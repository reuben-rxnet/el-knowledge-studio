import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EssilorLuxotticaLogo, LOGO_VIEWBOX } from "@/components/common/brand";

// "Don't modify the approved logo" is checked, not promised: the inlined mark must match the file.
describe("EssilorLuxottica logo", () => {
  const file = readFileSync(path.join(process.cwd(), "public", "brand", "essilorluxottica_logo.svg"), "utf8");
  const attrs = (svg: string, tag: string) => {
    const m = svg.match(new RegExp(`<${tag}\\b([^>]*)>`));
    return Object.fromEntries([...(m?.[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!.toLowerCase(), a[2]!]));
  };

  it("matches the approved file's geometry, font and colour", () => {
    const html = renderToStaticMarkup(createElement(EssilorLuxotticaLogo));
    expect(attrs(html, "svg").viewbox).toBe(attrs(file, "svg").viewbox);
    expect(LOGO_VIEWBOX).toBe(attrs(file, "svg").viewbox);
    const want = attrs(file, "text"), got = attrs(html, "text");
    for (const k of ["x", "y", "font-family", "font-size", "font-weight", "fill"]) expect(got[k], k).toBe(want[k]);
    expect(html).toContain(">EssilorLuxottica</text>");
    expect(file).toContain(">EssilorLuxottica</text>");
  });
});
