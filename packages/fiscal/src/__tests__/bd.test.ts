import { describe, expect, it } from "vitest";
import { calcularHash, docExportacao, serieDaLoja, textoParaHash, verificarExportacao, type DocumentoBD } from "../fiscal";

/** O mesmo vector está em supabase/tests/fiscal.sql (grupo 0): a BD e este pacote têm de dar o mesmo hash. */
const VECTOR = {
  dados: {
    dataEmissao: "2026-11-16",
    emitidoEm: new Date("2026-11-16T10:20:30.123Z"),
    numeroCompleto: "FR MPT2026/000001",
    totalCents: 90000,
    nuitAdquirente: "",
  },
  texto: "2026-11-16;2026-11-16T10:20:30.123Z;FR MPT2026/000001;900.00;999999999;",
  hash: "CqGwSCDlm5i/6joPfzp5T4cihBKfrD7+xOgzUj/qjdc=",
};

function doc(over: Partial<DocumentoBD> & Pick<DocumentoBD, "number" | "previous_hash">): DocumentoBD {
  const base: DocumentoBD = {
    doc_type: "FR",
    series: "MPT2026",
    full_number: `FR MPT2026/${String(over.number).padStart(6, "0")}`,
    issue_date: "2026-11-16",
    // Como a BD o devolve: com fuso, não em "Z".
    emitted_at: `2026-11-16T12:20:${String(over.number % 60).padStart(2, "0")}.000+02:00`,
    origin_number: null,
    buyer: { name: "Consumidor final", nuit: "" },
    base_cents: 10000,
    vat_cents: 1600,
    total_cents: 11600,
    payment_method: "cash",
    hash: "",
    voided: false,
    lines: [
      { description: "Artigo", quantity: 1, unit_price_cents: 10000, vat_bp: 1600, exemption_reason: null, base_cents: 10000, vat_cents: 1600 },
    ],
    ...over,
  };
  const hash = calcularHash(
    {
      dataEmissao: base.issue_date,
      emitidoEm: new Date(base.emitted_at),
      numeroCompleto: base.full_number,
      totalCents: base.total_cents,
      nuitAdquirente: base.buyer.nuit ?? "",
    },
    base.previous_hash,
  );
  return { ...base, hash: over.hash ?? hash };
}

describe("paridade com a BD (migration 1138)", () => {
  it("o texto e o hash são os de private.fiscal_hash", () => {
    expect(textoParaHash(VECTOR.dados, "")).toBe(VECTOR.texto);
    expect(calcularHash(VECTOR.dados, "")).toBe(VECTOR.hash);
  });

  it("série por loja e ano", () => {
    expect(serieDaLoja("MPT", "2026-11-16")).toBe("MPT2026");
  });

  it("documento da BD → linha do ficheiro do mês, com consumidor final e anulados", () => {
    const d = docExportacao(doc({ number: 7, previous_hash: "x", voided: true, buyer: {} }));
    expect(d).toMatchObject({
      tipo: "FR", serie: "MPT2026", numero: 7, nuitAdquirente: "", nomeAdquirente: "Consumidor final", anulado: true, taxaIvaBp: 1600,
    });
    expect(d.linhas).toEqual([
      { descricao: "Artigo", quantidade: 1, precoUnitarioCents: 10000, baseCents: 10000, ivaCents: 1600, taxaIvaBp: 1600 },
    ]);
  });

  it("a cadeia de uma exportação que começa a meio da série confere; mexer num documento parte-a", () => {
    const a = doc({ number: 41, previous_hash: "hash-do-40" });
    const b = doc({ number: 42, previous_hash: a.hash });
    const c = doc({ number: 43, previous_hash: b.hash });
    expect(verificarExportacao([c, a, b])).toBeNull();
    expect(verificarExportacao([a, { ...b, total_cents: 1 }, c])).toEqual({ numero: b.full_number, motivo: "hash" });
    expect(verificarExportacao([a, c])).toEqual({ numero: c.full_number, motivo: "sequencia" });
    expect(verificarExportacao([a, { ...b, previous_hash: "outro" }, c])).toEqual({ numero: b.full_number, motivo: "ligacao" });
  });
});
