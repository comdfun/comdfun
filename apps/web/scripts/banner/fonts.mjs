// The site's own IBM Plex, for templates rendered outside the site.
//
// Plex is not installed on the machines that render the banners; the site ships it through @fontsource, inside
// a stylesheet whose name changes with every build. A template that names "IBM Plex Sans" without loading it
// renders in whatever sans the system has, which is what the older banners were quietly doing. This reads the
// running site's stylesheets, keeps only the Plex @font-face rules, and points their URLs back at the site.
export async function siteFonts(base) {
  const html = await (await fetch(base)).text();
  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g), ...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)]
    .map((m) => m[1]);
  const rules = new Set();
  for (const href of new Set(hrefs)) {
    const css = await (await fetch(new URL(href, base))).text();
    for (const m of css.matchAll(/@font-face\s*{[^}]*}/g)) {
      if (!/IBM Plex (Sans|Mono)/.test(m[0])) continue;
      rules.add(m[0].replace(/url\((['"]?)(\/[^)'"]+)\1\)/g, (_, q, p) => `url(${q}${new URL(p, base)}${q})`));
    }
  }
  if (!rules.size) throw new Error(`no IBM Plex @font-face rules found in the stylesheets of ${base}`);
  return [...rules].join("\n");
}
