/** Tiny hyperscript-style DOM helpers. No framework, no virtual DOM —
 *  screens render real elements and re-render targeted subtrees on bus events. */

export type Child = Node | string | number | null | undefined | false | Child[];

export type Attrs = Record<
  string,
  | string
  | number
  | boolean
  | null
  | undefined
  | ((e: Event) => void)
  | Record<string, string | number> // style / dataset objects
>;

export function h(tag: string, attrs?: Attrs | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as (e: Event) => void);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'html') {
        el.innerHTML = String(v);
      } else if (k === 'style' && typeof v === 'object' && !(typeof v === 'function')) {
        Object.assign(el.style, v as Record<string, string>);
      } else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v as Record<string, string | number>)) el.dataset[dk] = String(dv);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el: HTMLElement | DocumentFragment, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Re-render helper: replace all children with fresh content. */
export function rerender(el: HTMLElement, ...children: Child[]): void {
  clear(el);
  appendChildren(el, children);
}

/** Number tween for satisfying counters (respects reduced motion). */
export function tweenNumber(
  el: HTMLElement,
  from: number,
  to: number,
  fmt: (n: number) => string,
  ms = 450,
): void {
  const reduce = document.body.classList.contains('reduced-motion');
  if (reduce || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
