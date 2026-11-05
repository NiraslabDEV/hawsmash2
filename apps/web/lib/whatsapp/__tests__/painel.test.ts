import { describe, expect, it } from "vitest";
import {
  eventLabel,
  FREE_SERVICE_MESSAGES,
  isMissingMigration,
  maskPhone,
  normalizePhone,
  parsePhoneList,
  saveErrorText,
  statusLabel,
  usageView,
  type WhatsAppMonth,
} from "../painel";
import { WHATSAPP_EVENTS } from "../events";

const month = (over: Partial<WhatsAppMonth> = {}): WhatsAppMonth => ({
  since: "2026-11-01", service_delivered: 0, utility_delivered: 0, marketing_delivered: 0,
  authentication_delivered: 0, failed: 0, waiting: 0, inbound: 0, orders: 0, ...over,
});

describe("telefones no painel", () => {
  it("aceita o que se escreve em Moçambique e internacional em E.164", () => {
    expect(normalizePhone("84 123 4567")).toBe("+258841234567");
    expect(normalizePhone("+258 87 030 1006")).toBe("+258870301006");
    expect(normalizePhone("+27 82 123 4567")).toBe("+27821234567");
    expect(normalizePhone("21 123 456")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("lista: sem repetidos, e diz o que não percebeu", () => {
    expect(parsePhoneList("84 123 4567; +258841234567\n85 111 2222, nao-e-telefone")).toEqual({
      phones: ["+258841234567", "+258851112222"], invalid: ["nao-e-telefone"],
    });
    expect(parsePhoneList("  ")).toEqual({ phones: [], invalid: [] });
  });
  it("mascara o número no histórico", () => {
    expect(maskPhone("+258841234567")).toBe("+258 84 ••• 4567");
    expect(maskPhone("+27821234567")).toBe("+278 ••• 4567");
  });
});

describe("uso do mês", () => {
  it("dentro das grátis só os avisos são cobrados", () => {
    expect(usageView(month({ service_delivered: 640, utility_delivered: 30 }))).toMatchObject({
      freeLeft: FREE_SERVICE_MESSAGES - 640, chargedService: 0, chargedTemplates: 30, chargedTotal: 30,
    });
  });
  it("acima das grátis conta só o excedente", () => {
    expect(usageView(month({ service_delivered: 1250, utility_delivered: 100, marketing_delivered: 5 }))).toMatchObject({
      freeLeft: 0, chargedService: 250, chargedTemplates: 105, chargedTotal: 355,
    });
  });
});

describe("textos do ecrã", () => {
  it("erros da BD viram frases; o desconhecido não se esconde", () => {
    expect(saveErrorText('new error: whatsapp_sender_required')).toContain("id do número");
    expect(saveErrorText("whatsapp_sender_taken")).toContain("outra loja");
    expect(saveErrorText("rede em baixo")).toBe("Não guardou: rede em baixo");
  });
  it("reconhece a BD ainda sem a migration", () => {
    expect(isMissingMigration("Could not find the function public.get_store_whatsapp(p_store_id) in the schema cache")).toBe(true);
    expect(isMissingMigration("forbidden")).toBe(false);
  });
  it("todos os eventos têm nome legível", () => {
    for (const event of [...WHATSAPP_EVENTS, "chat.reply"]) expect(eventLabel(event)).not.toBe(event);
    expect(statusLabel("delivered")).toBe("entregue");
  });
});
