import { z } from 'zod';
import { decimalStringToCents, type Cents } from './money';

/**
 * Formato canónico de importação de cardápio ("menu.json").
 *
 * É o padrão aceito: quando se pede "organiza os produtos do site X", o resultado
 * deve respeitar este schema. O preço vem em decimal MT (legível) e é convertido
 * para centavos inteiros via money.ts no `normalizeMenuImport` (única fonte de dinheiro).
 *
 * O formato é AGNÓSTICO de design: alimenta a BD (menu_categories/menu_items); qualquer
 * front lê depois via get_menu(). Trocar o design do front não afeta este contrato.
 */

const stationSchema = z.enum(['kitchen', 'bar', 'cold_kitchen']);

export const menuImportItemSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(''),
  // preço em MT decimal: número (130, 25.5) ou string ("130", "25.50").
  // null/omitido = "preço a confirmar" (ex.: carta de vinhos sem preço definido ainda) —
  // ver DECISÃO em normalizeMenuImport.
  price: z.union([z.number(), z.string()]).nullable().optional(),
  photo_url: z.string().optional().default(''),
  available: z.boolean().optional().default(true),
  track_stock: z.boolean().optional().default(false),
  stock_qty: z.number().int().min(0).optional().default(0),
  sort: z.number().int().optional().default(0),
});

export const menuImportCategorySchema = z.object({
  name: z.string().min(1).max(120),
  sort: z.number().int().optional().default(0),
  station: stationSchema.optional().default('kitchen'),
  active: z.boolean().optional().default(true),
  items: z.array(menuImportItemSchema).min(1, 'Cada categoria precisa de pelo menos 1 item'),
});

export const menuImportSchema = z.object({
  version: z.number().optional(),
  currency: z.string().optional(),
  categories: z.array(menuImportCategorySchema).min(1, 'O ficheiro precisa de pelo menos 1 categoria'),
});

export type MenuImport = z.infer<typeof menuImportSchema>;

/** Item normalizado (pronto para a BD): preço já em centavos inteiros. */
export interface NormalizedMenuItem {
  name: string;
  description: string;
  price_cents: Cents;
  photo_url: string;
  available: boolean;
  track_stock: boolean;
  stock_qty: number;
  sort: number;
}

export interface NormalizedMenuCategory {
  name: string;
  sort: number;
  station: z.infer<typeof stationSchema>;
  active: boolean;
  items: NormalizedMenuItem[];
}

export interface NormalizedMenu {
  categories: NormalizedMenuCategory[];
}

/**
 * Valida o payload bruto contra o schema e converte preços MT → centavos.
 * Lança erro claro (com o nome do item) se um preço for inválido.
 */
export function normalizeMenuImport(raw: unknown): NormalizedMenu {
  const parsed = menuImportSchema.parse(raw);

  return {
    categories: parsed.categories.map((c) => ({
      name: c.name.trim(),
      sort: c.sort,
      station: c.station,
      active: c.active,
      items: c.items.map((i) => {
        // DECISÃO: price null/omitido = "preço a confirmar" (ex.: carta de vinhos importada
        // sem preço definido). menu_items.price_cents é NOT NULL na BD, por isso usamos 0 como
        // sentinela — mas o item nasce SEMPRE available=false (nunca à venda por engano) e a
        // description ganha um aviso visível para quem gere o cardápio no admin.
        if (i.price === null || i.price === undefined) {
          const desc = i.description.trim();
          const marker = '(preço a confirmar)';
          return {
            name: i.name.trim(),
            description: desc.includes(marker) ? desc : [desc, marker].filter(Boolean).join(' '),
            price_cents: 0 as Cents,
            photo_url: i.photo_url.trim(),
            available: false,
            track_stock: i.track_stock,
            stock_qty: i.stock_qty,
            sort: i.sort,
          };
        }

        const priceStr = typeof i.price === 'number' ? i.price.toFixed(2) : i.price.trim();
        const n = parseFloat(priceStr);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`Preço inválido no item "${i.name}": ${JSON.stringify(i.price)}`);
        }
        return {
          name: i.name.trim(),
          description: i.description.trim(),
          price_cents: decimalStringToCents(priceStr),
          photo_url: i.photo_url.trim(),
          available: i.available,
          track_stock: i.track_stock,
          stock_qty: i.stock_qty,
          sort: i.sort,
        };
      }),
    })),
  };
}
