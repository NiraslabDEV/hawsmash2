import { describe, it, expect } from "vitest";
import { campaignToFlow, campaignPrompt } from "../campaign-skill";
const campaign = {
  name: "Voltar à mesa",
  strategy: "Convite e lembrete",
  steps: [
    {
      subject: "Olá",
      preheader: "Um convite",
      heading: "Volta quando quiseres",
      text: "Consulta o menu.",
      cta: "Ver menu",
      delay_minutes: 0,
    },
    {
      subject: "Até breve",
      preheader: "Sem pressa",
      heading: "Fica o convite",
      text: "Escolhe o teu favorito.",
      cta: "Abrir menu",
      delay_minutes: 1440,
    },
  ],
};
describe("gerador de campanhas", () => {
  it("transforma IA em rascunho manual, sem activar ou inscrever contactos", () => {
    const flow = campaignToFlow({
      ...campaign,
      status: "active",
      trigger: "subscribed",
    });
    expect(flow.status).toBe("draft");
    expect(flow.trigger).toBe("manual");
    expect(flow.steps[1].delay_minutes).toBe(1440);
    expect(flow.steps[0].blocks).toContainEqual({
      type: "button",
      text: "Ver menu",
      url: "{{menu_url}}",
    });
  });
  it("rejeita intervalos negativos e JSON incompleto", () => {
    expect(() =>
      campaignToFlow({
        ...campaign,
        steps: [{ ...campaign.steps[0], delay_minutes: -1 }],
      }),
    ).toThrow();
    expect(() => campaignToFlow({ name: "Sem etapas" })).toThrow();
  });
  it("mantém HTML como texto e ignora URLs propostas pelo modelo", () => {
    const flow = campaignToFlow({
      ...campaign,
      steps: [
        {
          ...campaign.steps[0],
          text: "<script>alert(1)</script>",
          url: "javascript:alert(1)",
        },
        campaign.steps[1],
      ],
    });
    expect(JSON.stringify(flow)).not.toContain("javascript:");
  });
  it("inclui conhecimento, objectivo e regras de consentimento e veracidade", () => {
    const prompt = campaignPrompt({
      objective: "Fazer regressar",
      audience: "Visitantes",
      offer: "Sem desconto",
      notes: "Tom acolhedor",
      count: 3,
      brand: { name: "Casa", store: "Centro", tagline: "À mesa" },
    });
    expect(prompt.system).toContain("Nunca inventes");
    expect(prompt.system).toContain("consentimento");
    expect(prompt.user).toContain("Tom acolhedor");
    expect(prompt.user).toContain("Fazer regressar");
  });
});
