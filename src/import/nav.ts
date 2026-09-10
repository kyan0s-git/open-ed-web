/**
 * Course ordering and hierarchy come from the rendered navigation, not from the
 * per-page JSON.
 *
 * OCW builds its sidebar from Hugo's menu system (`Site.Menus.leftnav`), and Hugo
 * keeps menu definitions out of `.Params` — so the `data.json` files carry content
 * but no weight or menu parent. The rendered nav does carry both: every entry is an
 * `a[data-uuid]` inside `li.course-nav-list-item`, and child lists are nested in
 * `ul.course-nav-child-nav`. Document order is menu weight order.
 */

export interface NavEntry {
  uid: string;
  title: string;
  /** href as published, or null for a section header that links nowhere. */
  href: string | null;
  parentUid: string | null;
  /** Position among siblings. */
  order: number;
}

export function parseNavTree(html: string): NavEntry[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nav = doc.querySelector("nav.course-nav");
  if (!nav) return [];

  const entries: NavEntry[] = [];
  const seen = new Set<string>();

  const walk = (list: Element, parentUid: string | null): void => {
    let order = 0;

    for (const item of childrenMatching(list, "li.course-nav-list-item")) {
      // The section toggle button also carries data-uuid; only the anchor is the entry.
      const link = item.querySelector(".course-nav-parent a[data-uuid]");
      const uid = link?.getAttribute("data-uuid")?.trim();

      if (uid && !seen.has(uid)) {
        seen.add(uid);
        const href = link?.getAttribute("href")?.trim() ?? null;
        entries.push({
          uid,
          title: link?.textContent?.trim() ?? "",
          href: href && href !== "#" ? href : null,
          parentUid,
          order: order++,
        });
      }

      for (const childList of childrenMatching(item, "ul.course-nav-child-nav")) {
        walk(childList, uid ?? parentUid);
      }
    }
  };

  for (const list of childrenMatching(nav, "ul")) walk(list, null);
  return entries;
}

/** Direct children only — nested lists must not be walked twice. */
function childrenMatching(parent: Element, selector: string): Element[] {
  return [...parent.children].filter((el) => el.matches(selector));
}
