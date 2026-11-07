// Passive readiness checks: never copy data-src into src or change site markup.
export async function componentState(page, selector) {
  return page.evaluate(async (cssSelector) => {
    const root = document.querySelector(cssSelector);
    if (!root) return { ready: false, signature: '' };
    const visible = (node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return (
        box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      );
    };
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();

      const round = (value) => Math.round(value * 10) / 10;

      return [
        round(rect.left - rootRect.left),
        round(rect.top - rootRect.top),
        round(rect.width),
        round(rect.height),
      ];
    };
    const images = [...root.querySelectorAll('img')];
    if (root.tagName === 'IMG') images.unshift(root);
    const shown = images.filter(visible);
    const data = await Promise.all(
      shown.map(async (img) => {
        const source = img.currentSrc || img.getAttribute('src') || '';
        const declaredLazySource = [
          'data-src',
          'data-srcset',
          'data-lazy-src',
          'data-original',
        ].some((name) => img.getAttribute(name));
        const pending =
          img.matches('.lazyload, .lazyloading') ||
          (declaredLazySource && (!source || source.startsWith('data:')));
        let decoded = false;
        if (img.complete && img.naturalWidth > 0 && !pending) {
          decoded = await Promise.race([
            img.decode().then(
              () => true,
              () => false,
            ),
            new Promise((resolve) => setTimeout(() => resolve(false), 200)),
          ]);
        }
        return {
          source,
          width: img.naturalWidth,
          height: img.naturalHeight,
          box: box(img),
          opacity: getComputedStyle(img).opacity,
          ready: decoded && !pending && getComputedStyle(img).opacity !== '0',
        };
      }),
    );
    const geometry = [root, ...root.querySelectorAll('*')].filter(visible).map(box);
    const state = { geometry, images: data, text: root.innerText, fonts: document.fonts.status };
    return {
      ready:
        visible(root) &&
        getComputedStyle(root).opacity !== '0' &&
        state.fonts === 'loaded' &&
        data.every((image) => image.ready),
      signature: JSON.stringify(state),
    };
  }, selector);
}

export async function waitForComponent(page, selector, config) {
  const locator = page.locator(selector);
  const deadline = Date.now() + config.limits.timeoutMs;
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error('COMPONENT_NOT_READY');
    return value;
  };
  await locator.scrollIntoViewIfNeeded({ timeout: remaining() });
  // Visit image positions so IntersectionObserver-based loaders get an opportunity
  // to run, including images below the viewport in a tall component.
  const images = locator.locator('img');
  const count = await images.count();
  if (count > 200) throw new Error('COMPONENT_IMAGE_LIMIT');
  for (let index = 0; index < count; index++) {
    const image = images.nth(index);
    if (!(await image.isVisible())) continue;
    await image.scrollIntoViewIfNeeded({ timeout: remaining() });
    try {
      await page.waitForFunction(
        (img) => {
          const source = img.currentSrc || img.getAttribute('src') || '';
          const lazy = ['data-src', 'data-srcset', 'data-lazy-src', 'data-original'].some((name) =>
            img.getAttribute(name),
          );
          return (
            img.complete &&
            img.naturalWidth > 0 &&
            !img.matches('.lazyload, .lazyloading') &&
            !(lazy && (!source || source.startsWith('data:')))
          );
        },
        await image.elementHandle(),
        { timeout: remaining() },
      );
    } catch {
      throw new Error('COMPONENT_NOT_READY');
    }
  }
  await locator.scrollIntoViewIfNeeded({ timeout: remaining() });
  let previous = null;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const state = await componentState(page, selector);
    if (!state.ready || state.signature !== previous) stableSince = Date.now();
    previous = state.signature;
    if (state.ready && Date.now() - stableSince >= 500) return state.signature;
    await page.waitForTimeout(Math.min(150, remaining()));
  }
  throw new Error('COMPONENT_NOT_READY');
}

export async function assertComponentUnchanged(page, selector, signature) {
  const state = await componentState(page, selector);
  if (!state.ready || state.signature !== signature)
    throw new Error('COMPONENT_CHANGED_DURING_CAPTURE');
}
