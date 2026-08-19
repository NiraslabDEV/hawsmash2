// Categorias hierárquicas (categoria-mãe → subcategorias), usado no admin
// (menu-section.tsx) para organizar o cardápio em árvore de profundidade
// arbitrária (ex.: Bebidas → Alcoólicas → Destilados → Whisky).

export type CategoryTreeNode<T> = T & { children: CategoryTreeNode<T>[] };

interface CategoryLike {
  id: string;
  parent_id: string | null;
  sort?: number;
}

export function buildCategoryTree<T extends CategoryLike>(categories: T[]): CategoryTreeNode<T>[] {
  const nodes = new Map<string, CategoryTreeNode<T>>();
  for (const cat of categories) {
    nodes.set(cat.id, { ...cat, children: [] });
  }

  const roots: CategoryTreeNode<T>[] = [];
  for (const cat of categories) {
    const node = nodes.get(cat.id)!;
    const parent = cat.parent_id ? nodes.get(cat.parent_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const bySort = (a: CategoryLike, b: CategoryLike) => (a.sort ?? 0) - (b.sort ?? 0);
  const sortTree = (list: CategoryTreeNode<T>[]) => {
    list.sort(bySort);
    for (const node of list) sortTree(node.children);
  };
  sortTree(roots);

  return roots;
}

export function findNode<T extends CategoryLike>(
  tree: CategoryTreeNode<T>[],
  id: string
): CategoryTreeNode<T> | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

// Descendentes de `node`, SEM incluir o próprio node.id.
export function collectDescendantIds<T extends CategoryLike>(node: CategoryTreeNode<T>): Set<string> {
  const ids = new Set<string>();
  const walk = (n: CategoryTreeNode<T>) => {
    for (const child of n.children) {
      ids.add(child.id);
      walk(child);
    }
  };
  walk(node);
  return ids;
}
