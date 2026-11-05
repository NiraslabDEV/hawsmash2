import type { ListRow, SessionContent } from './types';

/** Limites da Meta para mensagens interactivas. Acima disto a API recusa a mensagem inteira. */
export const LIMITS = {
  text: 4096,
  interactiveBody: 1024,
  headerFooter: 60,
  buttons: 3,
  buttonTitle: 20,
  buttonId: 256,
  listButton: 20,
  listRows: 10,
  listSections: 10,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
  sectionTitle: 24,
} as const;

/** Corta em caracteres visíveis (emoji conta um), com reticências quando corta. */
export function clip(value: string, max: number): string {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim());
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, Math.max(max - 1, 1)).join('').trimEnd()}…`;
}

function clipBody(value: string, max: number): string {
  const chars = Array.from(value.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** Títulos repetidos são recusados pela Meta: o segundo ganha um sufixo. */
function uniqueTitles<T extends { title: string }>(items: T[], max: number): T[] {
  const seen = new Set<string>();
  return items.map((item) => {
    let title = clip(item.title, max);
    for (let n = 2; seen.has(title.toLowerCase()); n++) title = clip(`${item.title}`, max - String(n).length - 1) + ` ${n}`;
    seen.add(title.toLowerCase());
    return { ...item, title };
  });
}

/**
 * Junta um texto à mensagem seguinte sempre que couber no limite do corpo. Desde 1/10/2026 a Meta cobra
 * cada mensagem de sessão acima das 1.000 grátis por número e por mês: duas bolhas seguidas custam o dobro de uma.
 */
export function compactSession(messages: SessionContent[]): SessionContent[] {
  const out: SessionContent[] = [];
  for (const message of messages) {
    const prev = out[out.length - 1];
    if (prev?.type === 'text') {
      const merged = `${prev.text}\n\n${message.text}`;
      const max = message.type === 'text' ? LIMITS.text : LIMITS.interactiveBody;
      if (Array.from(merged).length <= max) {
        out[out.length - 1] = { ...message, text: merged } as SessionContent;
        continue;
      }
    }
    out.push(message);
  }
  return out;
}

/**
 * Ajusta uma mensagem de sessão aos limites da Meta, sem nunca a tornar inválida:
 * corta textos, limita botões e linhas, e cai para texto simples se não sobrar nada clicável.
 */
export function fitSession(content: SessionContent): SessionContent {
  const extras = (c: { header?: string; footer?: string }) => ({
    ...(c.header?.trim() ? { header: clip(c.header, LIMITS.headerFooter) } : {}),
    ...(c.footer?.trim() ? { footer: clip(c.footer, LIMITS.headerFooter) } : {}),
  });
  switch (content.type) {
    case 'text':
      return { type: 'text', text: clipBody(content.text || ' ', LIMITS.text), ...(content.previewUrl ? { previewUrl: true } : {}) };
    case 'buttons': {
      const buttons = uniqueTitles(
        content.buttons.filter((b) => b.id && b.title.trim()).slice(0, LIMITS.buttons),
        LIMITS.buttonTitle,
      ).map((b) => ({ id: b.id.slice(0, LIMITS.buttonId), title: b.title }));
      if (!buttons.length) return fitSession({ type: 'text', text: content.text });
      return { type: 'buttons', text: clipBody(content.text, LIMITS.interactiveBody), ...extras(content), buttons };
    }
    case 'list': {
      let budget: number = LIMITS.listRows;
      const sections = content.sections.slice(0, LIMITS.listSections).map((section) => {
        const rows: ListRow[] = section.rows.filter((r) => r.id && r.title.trim()).slice(0, Math.max(budget, 0));
        budget -= rows.length;
        return { ...(section.title?.trim() ? { title: clip(section.title, LIMITS.sectionTitle) } : {}), rows };
      }).filter((section) => section.rows.length);
      if (!sections.length) return fitSession({ type: 'text', text: content.text });
      // Títulos únicos em toda a lista, não só por secção.
      const flat = uniqueTitles(sections.flatMap((s) => s.rows), LIMITS.rowTitle);
      let i = 0;
      const fitted = sections.map((section, index) => ({
        // Com mais de uma secção a Meta exige título em todas.
        ...(section.title ? { title: section.title } : sections.length > 1 ? { title: `Opções ${index + 1}` } : {}),
        rows: section.rows.map(() => {
          const row = flat[i++];
          return {
            id: row.id.slice(0, LIMITS.rowId),
            title: row.title,
            ...(row.description?.trim() ? { description: clip(row.description, LIMITS.rowDescription) } : {}),
          };
        }),
      }));
      return {
        type: 'list', text: clipBody(content.text, LIMITS.interactiveBody), ...extras(content),
        button: clip(content.button || 'Ver opções', LIMITS.listButton), sections: fitted,
      };
    }
    case 'request_contact':
      return { type: 'request_contact', text: clipBody(content.text, LIMITS.interactiveBody) };
    case 'cta_url':
      return {
        type: 'cta_url', text: clipBody(content.text, LIMITS.interactiveBody), ...extras(content),
        displayText: clip(content.displayText, LIMITS.buttonTitle), url: content.url,
      };
  }
}
