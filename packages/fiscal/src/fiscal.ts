/**
 * Facturação (Moçambique). Regras puras, sem I/O — ADR 0013.
 *
 * Quem emite é a BD (migration 1138), dentro da transacção da venda. Este pacote serve o que fica fora dela:
 * validar as definições no painel, gerar o ficheiro do mês e o SAF-T, e refazer a cadeia de hash de uma
 * exportação. `textoParaHash` é igual, byte a byte, a `private.fiscal_hash` — há um vector de ensaio dos dois lados.
 *
 * Base legal (ver FATURACAO-CERTIFICADA.md): Código do IVA, art. 27.º (obrigação de facturação, elementos da
 * factura, n.º 10 — comunicação das facturas à AT); Despacho Ministerial de 29/02/2012 (facturas processadas por
 * computador, programas autorizados pela AT); Aviso de 27/03/2025 (ficheiro mensal no e-Declaração).
 *
 * Princípios que o código garante:
 * - numeração sequencial SEM FALHAS por tipo e série (uma série por loja e por ano: `FR MPT2026/000001`);
 * - um documento emitido nunca muda nem se apaga (a BD recusa — gatilhos da migration 1138); corrige-se com
 *   Nota de Crédito, que referencia o original;
 * - cada documento guarda o hash do anterior da mesma série (cadeia): alterar um documento antigo parte a cadeia
 *   e a verificação de integridade aponta onde;
 * - em língua portuguesa e meticais; preço sem IVA, taxa e valor do IVA por linha; motivo quando não há IVA.
 * Dinheiro em centavos; taxa de IVA em pontos-base (16 % = 1600).
 */
import { createHash } from "node:crypto";

export type TipoDocumento = "FR" | "FT" | "NC";
export const NOME_TIPO: Record<TipoDocumento, string> = {
  FR: "Factura-Recibo",
  FT: "Factura",
  NC: "Nota de Crédito",
};

export type RegimeIva = "normal" | "ispc" | "isento";
export const NOME_REGIME: Record<RegimeIva, string> = {
  normal: "Regime normal de IVA",
  ispc: "Imposto Simplificado para Pequenos Contribuintes (ISPC)",
  isento: "Isento de IVA",
};

/** Taxa normal do IVA em Moçambique: 16 % (alteração da Lei 22/2022). Configurável, para o caso de a lei mudar. */
export const TAXA_IVA_NORMAL_BP = 1600;

export interface ConfigFiscal {
  ativa: boolean;
  nomeLegal: string;
  nuit: string;
  morada: string;
  regime: RegimeIva;
  taxaIvaBp: number;
  /** Obrigatório se o regime for "isento" (ex.: "Isento — artigo 9.º do Código do IVA"). */
  motivoIsencao: string;
  /** Número da autorização/certificação do programa pela AT (quando existir). */
  autorizacaoAT: string;
  /** Instante (ISO) a partir do qual as vendas geram documento fiscal (as anteriores nunca são facturadas). */
  ativaDesde: string | null;
}

export const CONFIG_FISCAL_PADRAO: ConfigFiscal = {
  ativa: false,
  nomeLegal: "",
  nuit: "",
  morada: "",
  regime: "normal",
  taxaIvaBp: TAXA_IVA_NORMAL_BP,
  motivoIsencao: "",
  autorizacaoAT: "",
  ativaDesde: null,
};

/** NUIT de Moçambique: 9 dígitos. */
export const nuitValido = (n: string) => /^\d{9}$/.test(n.replace(/\s/g, ""));
export const limparNuit = (n: string) => n.replace(/\s/g, "");

export function validarConfig(c: ConfigFiscal): string | null {
  if (!c.nomeLegal.trim()) return "Indique o nome legal (como no registo comercial).";
  if (!nuitValido(c.nuit)) return "O NUIT tem 9 dígitos.";
  if (!c.morada.trim()) return "Indique a morada da sede.";
  if (c.regime === "normal" && !(c.taxaIvaBp > 0 && c.taxaIvaBp <= 5000)) return "Taxa de IVA inválida.";
  if (c.regime === "isento" && c.motivoIsencao.trim().length < 10)
    return "No regime isento, escreva o motivo da isenção (artigo da lei).";
  return null;
}

/** Preço com IVA incluído → base e IVA (o IVA é o resto, para a soma bater sempre certo). */
export function decomporIva(totalCents: number, taxaBp: number): { baseCents: number; ivaCents: number } {
  if (taxaBp <= 0) return { baseCents: totalCents, ivaCents: 0 };
  const baseCents = Math.round((totalCents * 10000) / (10000 + taxaBp));
  return { baseCents, ivaCents: totalCents - baseCents };
}

export interface LinhaEntrada {
  descricao: string;
  quantidade: number;
  /** Preço total da linha COM IVA incluído (como no cardápio). */
  totalCents: number;
}

export interface LinhaFiscal {
  ordem: number;
  descricao: string;
  quantidade: number;
  precoUnitarioCents: number;
  taxaIvaBp: number;
  motivoIsencao: string | null;
  baseCents: number;
  ivaCents: number;
  totalCents: number;
}

export interface Totais {
  baseCents: number;
  ivaCents: number;
  totalCents: number;
}

export function linhasFiscais(
  entradas: LinhaEntrada[],
  c: Pick<ConfigFiscal, "regime" | "taxaIvaBp" | "motivoIsencao">,
): { linhas: LinhaFiscal[]; totais: Totais } {
  const taxa = c.regime === "normal" ? c.taxaIvaBp : 0;
  const motivo =
    c.regime === "normal"
      ? null
      : c.regime === "ispc"
        ? "IVA não aplicável — regime ISPC"
        : c.motivoIsencao.trim();
  const linhas = entradas.map((e, i) => {
    const { baseCents, ivaCents } = decomporIva(e.totalCents, taxa);
    const q = Math.max(1, e.quantidade);
    return {
      ordem: i + 1,
      descricao: e.descricao.slice(0, 200),
      quantidade: q,
      precoUnitarioCents: Math.round(baseCents / q),
      taxaIvaBp: taxa,
      motivoIsencao: motivo,
      baseCents,
      ivaCents,
      totalCents: e.totalCents,
    };
  });
  const totais = linhas.reduce(
    (t, l) => ({
      baseCents: t.baseCents + l.baseCents,
      ivaCents: t.ivaCents + l.ivaCents,
      totalCents: t.totalCents + l.totalCents,
    }),
    { baseCents: 0, ivaCents: 0, totalCents: 0 },
  );
  return { linhas, totais };
}

/** Série anual: "2026". O número completo: "FR 2026/000123". */
export const serieDoAno = (data: string) => data.slice(0, 4);
/** Série por loja e ano: prefixo dos pedidos da loja + ano ("MPT2026"). Lojas que emitem em paralelo não partilham numeração. */
export const serieDaLoja = (prefixo: string, data: string) => `${prefixo}${serieDoAno(data)}`;
export const numeroCompleto = (tipo: TipoDocumento, serie: string, numero: number) =>
  `${tipo} ${serie}/${String(numero).padStart(6, "0")}`;

export interface DadosHash {
  dataEmissao: string;
  emitidoEm: Date;
  numeroCompleto: string;
  totalCents: number;
  nuitAdquirente: string;
}

/** Texto que entra no hash: campos que identificam o documento + o hash do anterior da série. */
export function textoParaHash(d: DadosHash, hashAnterior: string): string {
  return [
    d.dataEmissao,
    d.emitidoEm.toISOString(),
    d.numeroCompleto,
    (d.totalCents / 100).toFixed(2),
    d.nuitAdquirente || "999999999",
    hashAnterior,
  ].join(";");
}

export const calcularHash = (d: DadosHash, hashAnterior: string) =>
  createHash("sha256").update(textoParaHash(d, hashAnterior)).digest("base64");

/** 4 caracteres do hash impressos no documento (1.º, 11.º, 21.º e 31.º) — permitem conferir o papel com o sistema. */
export const codigoControlo = (hash: string) => [0, 10, 20, 30].map((i) => hash.charAt(i)).join("");

/**
 * Verifica a cadeia de uma série (por ordem de número). Devolve null se estiver íntegra ou o número do primeiro
 * documento em falha (hash que não bate, número em falta ou repetido).
 */
export function verificarCadeia(
  docs: (DadosHash & { numero: number; hash: string; hashAnterior: string })[],
): { ok: true } | { ok: false; numero: number; motivo: "hash" | "sequencia" | "ligacao" } {
  let anterior = "";
  let esperado = 1;
  for (const d of [...docs].sort((a, b) => a.numero - b.numero)) {
    if (d.numero !== esperado) return { ok: false, numero: d.numero, motivo: "sequencia" };
    if (d.hashAnterior !== anterior) return { ok: false, numero: d.numero, motivo: "ligacao" };
    if (calcularHash(d, anterior) !== d.hash) return { ok: false, numero: d.numero, motivo: "hash" };
    anterior = d.hash;
    esperado++;
  }
  return { ok: true };
}

export const CONSUMIDOR_FINAL = { nome: "Consumidor final", nuit: "" };

// ---------- ficheiro mensal (e-Declaração) e SAF-T ----------

export interface DocExportacao {
  tipo: TipoDocumento;
  serie: string;
  numero: number;
  numeroCompleto: string;
  dataEmissao: string;
  nuitAdquirente: string;
  nomeAdquirente: string;
  baseCents: number;
  ivaCents: number;
  totalCents: number;
  taxaIvaBp: number;
  motivoIsencao: string | null;
  anulado: boolean;
  documentoOrigem: string | null;
  hash: string;
  metodoPagamento: string | null;
  linhas: {
    descricao: string;
    quantidade: number;
    precoUnitarioCents: number;
    baseCents: number;
    ivaCents: number;
    taxaIvaBp: number;
  }[];
}

const mt = (c: number) => (c / 100).toFixed(2);

/**
 * Colunas do ficheiro de facturas do mês. [PROVISÓRIO] O modelo oficial é entregue pela AT às empresas de software
 * (efacturação@at.gov.mz); estas colunas cobrem os elementos do art. 27.º e ajustam-se aqui quando chegar.
 */
export const COLUNAS_EXPORTACAO = [
  "NUIT do emitente",
  "Tipo de documento",
  "Série",
  "Número",
  "Número do documento",
  "Data de emissão",
  "NUIT do adquirente",
  "Nome do adquirente",
  "Base tributável (MT)",
  "Taxa de IVA (%)",
  "IVA (MT)",
  "Total (MT)",
  "Motivo de isenção",
  "Estado",
  "Documento de origem",
  "Meio de pagamento",
  "Hash",
] as const;

export function linhasExportacao(nuitEmitente: string, docs: DocExportacao[]): string[][] {
  return docs.map((d) => [
    nuitEmitente,
    d.tipo,
    d.serie,
    String(d.numero),
    d.numeroCompleto,
    d.dataEmissao,
    d.nuitAdquirente || "999999999",
    d.nomeAdquirente,
    mt(d.baseCents),
    (d.taxaIvaBp / 100).toFixed(2),
    mt(d.ivaCents),
    mt(d.totalCents),
    d.motivoIsencao ?? "",
    d.anulado ? "A" : "N",
    d.documentoOrigem ?? "",
    d.metodoPagamento ?? "",
    d.hash,
  ]);
}

export function csv(linhas: string[][]): string {
  const q = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // BOM em escape: o Excel abre o CSV em UTF-8 e o ficheiro-fonte fica sem caracteres invisíveis.
  return `\uFEFF${linhas.map((l) => l.map(q).join(";")).join("\r\n")}\r\n`;
}

const xml = (v: string) =>
  v.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string,
  );

/**
 * SAF-T de referência (estrutura OCDE, como o SAF-T usado em países lusófonos), só a parte de facturação.
 * [PROVISÓRIO] O diploma que fixa o SAF-T (MZ) ainda não foi publicado; serve para auditoria e para o contabilista,
 * e ajusta-se ao esquema oficial quando a AT o publicar.
 */
export function saftXml(e: {
  emitente: { nuit: string; nome: string; morada: string };
  inicio: string;
  fim: string;
  geradoEm: Date;
  produto: { nome: string; versao: string; autorizacao: string };
  docs: DocExportacao[];
}): string {
  const linhas: string[] = [];
  const add = (s: string) => linhas.push(s);
  add('<?xml version="1.0" encoding="UTF-8"?>');
  add('<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:MZ_1.00_01">');
  add("  <Header>");
  add("    <AuditFileVersion>1.00_01</AuditFileVersion>");
  add(`    <CompanyID>${xml(e.emitente.nuit)}</CompanyID>`);
  add(`    <TaxRegistrationNumber>${xml(e.emitente.nuit)}</TaxRegistrationNumber>`);
  add("    <TaxAccountingBasis>F</TaxAccountingBasis>");
  add(`    <CompanyName>${xml(e.emitente.nome)}</CompanyName>`);
  add(
    `    <CompanyAddress><AddressDetail>${xml(e.emitente.morada)}</AddressDetail><Country>MZ</Country></CompanyAddress>`,
  );
  add(`    <FiscalYear>${e.inicio.slice(0, 4)}</FiscalYear>`);
  add(`    <StartDate>${e.inicio}</StartDate>`);
  add(`    <EndDate>${e.fim}</EndDate>`);
  add("    <CurrencyCode>MZN</CurrencyCode>");
  add(`    <DateCreated>${e.geradoEm.toISOString().slice(0, 10)}</DateCreated>`);
  add(`    <ProductID>${xml(e.produto.nome)}</ProductID>`);
  add(`    <ProductVersion>${xml(e.produto.versao)}</ProductVersion>`);
  add(`    <SoftwareCertificateNumber>${xml(e.produto.autorizacao || "0")}</SoftwareCertificateNumber>`);
  add("  </Header>");
  add("  <MasterFiles>");
  const clientes = new Map<string, string>();
  for (const d of e.docs)
    clientes.set(d.nuitAdquirente || "999999999", d.nuitAdquirente ? d.nomeAdquirente : "Consumidor final");
  for (const [nuit, nome] of clientes)
    add(
      `    <Customer><CustomerID>${xml(nuit)}</CustomerID><CustomerTaxID>${xml(nuit)}</CustomerTaxID><CompanyName>${xml(nome)}</CompanyName></Customer>`,
    );
  add("  </MasterFiles>");
  const validos = e.docs.filter((d) => !d.anulado);
  const debito = validos.filter((d) => d.tipo === "NC").reduce((t, d) => t + d.totalCents - d.ivaCents, 0);
  const credito = validos.filter((d) => d.tipo !== "NC").reduce((t, d) => t + d.totalCents - d.ivaCents, 0);
  add("  <SourceDocuments>");
  add("    <SalesInvoices>");
  add(`      <NumberOfEntries>${e.docs.length}</NumberOfEntries>`);
  add(`      <TotalDebit>${mt(debito)}</TotalDebit>`);
  add(`      <TotalCredit>${mt(credito)}</TotalCredit>`);
  for (const d of e.docs) {
    add("      <Invoice>");
    add(`        <InvoiceNo>${xml(d.numeroCompleto)}</InvoiceNo>`);
    add(`        <DocumentStatus><InvoiceStatus>${d.anulado ? "A" : "N"}</InvoiceStatus></DocumentStatus>`);
    add(`        <Hash>${xml(d.hash)}</Hash>`);
    add(`        <InvoiceDate>${d.dataEmissao}</InvoiceDate>`);
    add(`        <InvoiceType>${d.tipo}</InvoiceType>`);
    add(`        <CustomerID>${xml(d.nuitAdquirente || "999999999")}</CustomerID>`);
    d.linhas.forEach((l, i) => {
      add("        <Line>");
      add(`          <LineNumber>${i + 1}</LineNumber>`);
      if (d.documentoOrigem)
        add(`          <References><Reference>${xml(d.documentoOrigem)}</Reference></References>`);
      add(`          <Description>${xml(l.descricao)}</Description>`);
      add(`          <Quantity>${l.quantidade}</Quantity>`);
      add(`          <UnitPrice>${mt(l.precoUnitarioCents)}</UnitPrice>`);
      add(
        `          <${d.tipo === "NC" ? "DebitAmount" : "CreditAmount"}>${mt(l.baseCents)}</${d.tipo === "NC" ? "DebitAmount" : "CreditAmount"}>`,
      );
      add(
        `          <Tax><TaxType>IVA</TaxType><TaxCountryRegion>MZ</TaxCountryRegion><TaxPercentage>${(l.taxaIvaBp / 100).toFixed(2)}</TaxPercentage></Tax>`,
      );
      if (l.taxaIvaBp === 0 && d.motivoIsencao)
        add(`          <TaxExemptionReason>${xml(d.motivoIsencao)}</TaxExemptionReason>`);
      add("        </Line>");
    });
    add(
      `        <DocumentTotals><TaxPayable>${mt(d.ivaCents)}</TaxPayable><NetTotal>${mt(d.baseCents)}</NetTotal><GrossTotal>${mt(d.totalCents)}</GrossTotal></DocumentTotals>`,
    );
    add("      </Invoice>");
  }
  add("    </SalesInvoices>");
  add("  </SourceDocuments>");
  add("</AuditFile>");
  return `${linhas.join("\n")}\n`;
}

// ---------- da BD para as regras ----------

/** Um documento tal como `fiscal_export_month` e `get_order_fiscal_documents` o devolvem (migration 1138). */
export interface DocumentoBD {
  doc_type: TipoDocumento;
  series: string;
  number: number;
  full_number: string;
  issue_date: string;
  emitted_at: string;
  origin_number: string | null;
  buyer: { name?: string | null; nuit?: string | null };
  base_cents: number;
  vat_cents: number;
  total_cents: number;
  payment_method: string | null;
  hash: string;
  previous_hash: string;
  voided: boolean;
  lines: Array<{
    description: string;
    quantity: number;
    unit_price_cents: number;
    vat_bp: number;
    exemption_reason: string | null;
    base_cents: number;
    vat_cents: number;
  }> | null;
}

export function docExportacao(d: DocumentoBD): DocExportacao {
  const linhas = d.lines ?? [];
  return {
    tipo: d.doc_type,
    serie: d.series,
    numero: d.number,
    numeroCompleto: d.full_number,
    dataEmissao: d.issue_date,
    nuitAdquirente: d.buyer.nuit ?? "",
    nomeAdquirente: d.buyer.name ?? CONSUMIDOR_FINAL.nome,
    baseCents: d.base_cents,
    ivaCents: d.vat_cents,
    totalCents: d.total_cents,
    taxaIvaBp: linhas[0]?.vat_bp ?? 0,
    motivoIsencao: linhas[0]?.exemption_reason ?? null,
    anulado: d.voided,
    documentoOrigem: d.origin_number,
    hash: d.hash,
    metodoPagamento: d.payment_method,
    linhas: linhas.map((l) => ({
      descricao: l.description,
      quantidade: l.quantity,
      precoUnitarioCents: l.unit_price_cents,
      baseCents: l.base_cents,
      ivaCents: l.vat_cents,
      taxaIvaBp: l.vat_bp,
    })),
  };
}

/** Refaz a cadeia de uma exportação, série a série. Devolve o primeiro documento em falha, ou null se estiver íntegra. */
export function verificarExportacao(
  docs: DocumentoBD[],
): { numero: string; motivo: "hash" | "sequencia" | "ligacao" } | null {
  const series = new Map<string, DocumentoBD[]>();
  for (const d of docs) {
    const chave = `${d.doc_type} ${d.series}`;
    series.set(chave, [...(series.get(chave) ?? []), d]);
  }
  for (const lista of series.values()) {
    const ordenados = [...lista].sort((a, b) => a.number - b.number);
    // Uma exportação de um mês começa a meio da série: a ligação confere-se a partir do primeiro que se tem.
    let anterior = ordenados[0].previous_hash;
    let esperado = ordenados[0].number;
    for (const d of ordenados) {
      if (d.number !== esperado) return { numero: d.full_number, motivo: "sequencia" };
      if (d.previous_hash !== anterior) return { numero: d.full_number, motivo: "ligacao" };
      const hash = calcularHash(
        {
          dataEmissao: d.issue_date,
          emitidoEm: new Date(d.emitted_at),
          numeroCompleto: d.full_number,
          totalCents: d.total_cents,
          nuitAdquirente: d.buyer.nuit ?? "",
        },
        anterior,
      );
      if (hash !== d.hash) return { numero: d.full_number, motivo: "hash" };
      anterior = d.hash;
      esperado++;
    }
  }
  return null;
}
