import { describe, expect, it } from "vitest";
import {
  CONFIG_FISCAL_PADRAO,
  calcularHash,
  codigoControlo,
  csv,
  decomporIva,
  linhasExportacao,
  linhasFiscais,
  nuitValido,
  numeroCompleto,
  saftXml,
  validarConfig,
  verificarCadeia,
} from "../fiscal";

describe("IVA", () => {
  it("decompõe o preço com IVA incluído sem perder centavos", () => {
    expect(decomporIva(116_000, 1600)).toEqual({ baseCents: 100_000, ivaCents: 16_000 });
    const r = decomporIva(150_000, 1600);
    expect(r.baseCents + r.ivaCents).toBe(150_000);
    expect(r.baseCents).toBe(129_310);
    expect(decomporIva(150_000, 0)).toEqual({ baseCents: 150_000, ivaCents: 0 });
  });

  it("linhas e totais batem certo em todos os regimes", () => {
    const entradas = [
      { descricao: "Mensal", quantidade: 1, totalCents: 150_000 },
      { descricao: "Inscrição", quantidade: 1, totalCents: 50_001 },
    ];
    const n = linhasFiscais(entradas, { regime: "normal", taxaIvaBp: 1600, motivoIsencao: "" });
    expect(n.totais.totalCents).toBe(200_001);
    expect(n.totais.baseCents + n.totais.ivaCents).toBe(200_001);
    expect(n.linhas.every((l) => l.motivoIsencao === null && l.taxaIvaBp === 1600)).toBe(true);
    const i = linhasFiscais(entradas, { regime: "ispc", taxaIvaBp: 1600, motivoIsencao: "" });
    expect(i.totais.ivaCents).toBe(0);
    expect(i.linhas[0]?.motivoIsencao).toMatch(/ISPC/);
    const z = linhasFiscais(entradas, {
      regime: "isento",
      taxaIvaBp: 1600,
      motivoIsencao: "Isento — artigo 9.º do CIVA",
    });
    expect(z.linhas[0]?.motivoIsencao).toMatch(/artigo 9/);
  });
});

describe("configuração", () => {
  const base = {
    ...CONFIG_FISCAL_PADRAO,
    nomeLegal: "Empresa Exemplo, Lda",
    nuit: "400123456",
    morada: "Av. Marginal, Maputo",
  };
  it("exige nome legal, NUIT de 9 dígitos, morada e motivo de isenção quando isento", () => {
    expect(validarConfig(base)).toBeNull();
    expect(validarConfig({ ...base, nuit: "12345" })).toMatch(/9 dígitos/);
    expect(validarConfig({ ...base, regime: "isento", motivoIsencao: "" })).toMatch(/motivo/);
    expect(nuitValido("400 123 456")).toBe(true);
  });
});

describe("cadeia de documentos", () => {
  const doc = (numero: number, total: number) => ({
    numero,
    dataEmissao: "2026-10-19",
    emitidoEm: new Date(`2026-10-19T08:0${numero}:00Z`),
    numeroCompleto: numeroCompleto("FR", "2026", numero),
    totalCents: total,
    nuitAdquirente: "",
  });
  const cadeia = () => {
    let anterior = "";
    return [doc(1, 150_000), doc(2, 90_000), doc(3, 200_000)].map((d) => {
      const hash = calcularHash(d, anterior);
      const r = { ...d, hash, hashAnterior: anterior };
      anterior = hash;
      return r;
    });
  };

  it("numera com série e zeros, e uma cadeia íntegra verifica", () => {
    expect(numeroCompleto("FR", "2026", 123)).toBe("FR 2026/000123");
    expect(verificarCadeia(cadeia())).toEqual({ ok: true });
    expect(codigoControlo(cadeia()[0]?.hash ?? "")).toHaveLength(4);
  });

  it("alterar o valor de um documento antigo é detectado", () => {
    const c = cadeia();
    (c[1] as { totalCents: number }).totalCents = 10_000;
    expect(verificarCadeia(c)).toEqual({ ok: false, numero: 2, motivo: "hash" });
  });

  it("apagar um documento é detectado (falha na sequência)", () => {
    const c = cadeia();
    expect(verificarCadeia([c[0], c[2]] as typeof c)).toEqual({ ok: false, numero: 3, motivo: "sequencia" });
  });
});

describe("ficheiros para a AT", () => {
  const d = {
    tipo: "FR" as const,
    serie: "2026",
    numero: 1,
    numeroCompleto: "FR 2026/000001",
    dataEmissao: "2026-10-19",
    nuitAdquirente: "",
    nomeAdquirente: "Consumidor final",
    baseCents: 129_310,
    ivaCents: 20_690,
    totalCents: 150_000,
    taxaIvaBp: 1600,
    motivoIsencao: null,
    anulado: false,
    documentoOrigem: null,
    hash: "abc",
    metodoPagamento: "mpesa",
    linhas: [
      {
        descricao: "Mensal <Costa do Sol>",
        quantidade: 1,
        precoUnitarioCents: 129_310,
        baseCents: 129_310,
        ivaCents: 20_690,
        taxaIvaBp: 1600,
      },
    ],
  };
  it("CSV com consumidor final 999999999 e valores em meticais", () => {
    const [l] = linhasExportacao("400123456", [d]);
    expect(l).toContain("999999999");
    expect(l).toContain("1293.10");
    expect(csv([["a;b", 'x"y']])).toBe('\uFEFF"a;b";"x""y"\r\n');
  });
  it("SAF-T com cabeçalho, cliente e totais, e texto escapado", () => {
    const x = saftXml({
      emitente: { nuit: "400123456", nome: "Empresa Exemplo, Lda", morada: "Maputo" },
      inicio: "2026-10-01",
      fim: "2026-10-31",
      geradoEm: new Date("2026-11-01T00:00:00Z"),
      produto: { nome: "Gym OS", versao: "1.0", autorizacao: "" },
      docs: [d],
    });
    expect(x).toContain("<TaxRegistrationNumber>400123456</TaxRegistrationNumber>");
    expect(x).toContain("<GrossTotal>1500.00</GrossTotal>");
    expect(x).toContain("Mensal &lt;Costa do Sol&gt;");
    expect(x).toContain("<CustomerID>999999999</CustomerID>");
  });
});
