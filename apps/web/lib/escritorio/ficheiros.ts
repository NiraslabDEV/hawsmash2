/**
 * Ficheiros para o contabilista (ADR 0014): o mês das facturas (CSV para o e-Declaração e XML SAF-T de referência)
 * e as compras. Só no servidor: usa o hash de `@delivery/fiscal` para verificar a cadeia antes de entregar.
 */
import {
  COLUNAS_EXPORTACAO, csv, docExportacao, linhasExportacao, saftXml, verificarExportacao, type DocumentoBD,
} from '@delivery/fiscal';

export type MonthExport = {
  issuer: { name: string; nuit: string; address: string; at_certificate?: string | null } | null;
  from: string;
  to: string;
  documents: DocumentoBD[];
};

export type Purchase = {
  store: string;
  supplier_name: string;
  supplier_nuit: string | null;
  invoice_number: string;
  invoice_date: string;
  category: string;
  total_cents: number;
  vat_cents: number;
  deductible: boolean;
  has_file: boolean;
};

export type ExportFormat = 'csv' | 'xml' | 'compras';

/** Antes de entregar: a cadeia de cada série tem de bater. Se não bater, não sai ficheiro nenhum. */
export function checkExport(data: MonthExport): { ok: true } | { ok: false; error: string } {
  if (!data.issuer?.nuit) return { ok: false, error: 'Falta o NUIT da empresa nas definições fiscais.' };
  const broken = verificarExportacao(data.documents);
  if (broken) {
    const motivo = { hash: 'o conteúdo não bate com o hash', sequencia: 'falta um número', ligacao: 'a ligação ao anterior está partida' }[broken.motivo];
    return { ok: false, error: `A cadeia de documentos falhou em ${broken.numero} (${motivo}). Não entregues este ficheiro: contacta o suporte.` };
  }
  return { ok: true };
}

const reais = (c: number) => (c / 100).toFixed(2);

export function buildMonthFile(format: ExportFormat, data: MonthExport, purchases: Purchase[], now = new Date()):
  { body: string; contentType: string; fileName: string } {
  const ym = data.from.slice(0, 7);
  if (format === 'compras') {
    const header = ['Loja', 'Fornecedor', 'NUIT do fornecedor', 'N.º da factura', 'Data', 'Categoria', 'Total (MT)', 'IVA (MT)', 'IVA dedutível', 'Ficheiro anexo'];
    const rows = purchases.map((p) => [
      p.store, p.supplier_name, p.supplier_nuit ?? '', p.invoice_number, p.invoice_date, p.category,
      reais(p.total_cents), reais(p.vat_cents), p.deductible ? 'Sim' : 'Não', p.has_file ? 'Sim' : 'Não',
    ]);
    return { body: csv([header, ...rows]), contentType: 'text/csv; charset=utf-8', fileName: `compras-${ym}.csv` };
  }
  const docs = data.documents.map(docExportacao);
  if (format === 'xml') {
    return {
      body: saftXml({
        emitente: { nuit: data.issuer!.nuit, nome: data.issuer!.name, morada: data.issuer!.address },
        inicio: data.from, fim: data.to, geradoEm: now,
        produto: { nome: 'WinTable', versao: '1.0', autorizacao: data.issuer!.at_certificate ?? '' },
        docs,
      }),
      contentType: 'application/xml; charset=utf-8',
      fileName: `saft-${data.issuer!.nuit}-${ym}.xml`,
    };
  }
  return {
    body: csv([[...COLUNAS_EXPORTACAO], ...linhasExportacao(data.issuer!.nuit, docs)]),
    contentType: 'text/csv; charset=utf-8',
    fileName: `facturas-${data.issuer!.nuit}-${ym}.csv`,
  };
}
