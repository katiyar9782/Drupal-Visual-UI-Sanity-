// Adapter interface: detect(page, config, metadata) -> ComponentSnapshot[].
export async function detect(page, c, meta = {}) {
  const items = await page.evaluate(
    ({ detection, styles, max }) => {
      const visible = (n) => {
        const b = n.getBoundingClientRect(),
          s = getComputedStyle(n);
        return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const type = (node) => {
        for (const className of node.classList) {
          // Standard Drupal Paragraph classes.
          const standard = className.match(/^paragraph--type--(.+)$/);

          if (standard) {
            return standard[1];
          }

          // Custom theme: paragraph--COMPONENT_NAME--NUMERIC_ID.
          const custom = className.match(/^paragraph--(.+?)--\d+$/);

          if (custom) {
            return custom[1];
          }
        }

        return undefined;
      };
      const drupal = detection.drupalParagraphs
        ? [...document.querySelectorAll('[class*="paragraph--"]')].filter(
            (n) => type(n) && visible(n),
          )
        : [];
      const fallback = [
        ...(detection.semanticFallback ? ['header', 'footer', 'main > section', 'article'] : []),
        ...detection.customSelectors,
      ];
      const candidates = new Set(drupal);
      for (const selector of fallback)
        for (const n of document.querySelectorAll(selector))
          if (visible(n) && ![...candidates].some((p) => p === n || p.contains(n) || n.contains(p)))
            candidates.add(n);
      const nodes = [...candidates].sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
      if (nodes.length > max) throw Error('COMPONENT_LIMIT');
      const selector = (n) => {
        const parts = [];
        while (n && n.nodeType === 1) {
          const name = n.tagName.toLowerCase();
          const idx =
            [...(n.parentElement?.children ?? [])]
              .filter((x) => x.tagName === n.tagName)
              .indexOf(n) + 1;
          parts.unshift(name + `:nth-of-type(${Math.max(1, idx)})`);
          n = n.parentElement;
        }
        return parts.join(' > ');
      };
      const normalized = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
      const rect = (n) => {
        const b = n.getBoundingClientRect();
        return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height };
      };
      const assetUrl = (s) => {
        try {
          const u = new URL(s, location.href);
          return u.pathname;
        } catch {
          return '';
        }
      };
      return nodes.map((n, index) => {
        const parent = nodes.find(
          (p) =>
            p !== n &&
            p.contains(n) &&
            !nodes.some((q) => q !== p && q !== n && p.contains(q) && q.contains(n)),
        );
        const b = rect(n),
          pb = parent ? rect(parent) : { x: 0, y: 0 };
        const css = getComputedStyle(n);
        // innerText excludes hidden descendants in the browser.
        const text = normalized(n.innerText);
        const assets = [...n.querySelectorAll('img')].map((i) => ({
          path: assetUrl(i.currentSrc || i.src),
          naturalWidth: i.naturalWidth,
          naturalHeight: i.naturalHeight,
          broken: !i.naturalWidth,
        }));
        for (const el of [n, ...n.querySelectorAll('*')]) {
          const bg = getComputedStyle(el).backgroundImage;
          for (const match of bg.matchAll(/url\(["']?(.*?)["']?\)/g))
            assets.push({ path: assetUrl(match[1]), kind: 'background' });
        }
        return {
          id: 'c' + index,
          type: type(n) || 'semantic:' + n.tagName.toLowerCase(),
          selectorHint: selector(n),
          parentId: parent ? 'c' + nodes.indexOf(parent) : null,
          siblingIndex: nodes.filter((p) => p.parentElement === n.parentElement).indexOf(n),
          heading: normalized(n.querySelector('h1,h2,h3,h4,h5,h6')?.innerText),
          textSignature: text,
          bbox: b,
          relative: { x: b.x - pb.x, y: parent ? b.y - pb.y : 0 },
          styles: Object.fromEntries(styles.map((k) => [k, css.getPropertyValue(k)])),
          assetRefs: assets,
          visibility: true,
          captureWarnings: [],
        };
      });
    },
    { detection: c.detection, styles: c.comparison.styles, max: c.limits.maxComponents },
  );
  return items.map((x) => ({ ...x, ...meta }));
}
