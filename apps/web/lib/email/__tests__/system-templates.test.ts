import { describe, expect, it } from "vitest";
import {
  SYSTEM_EMAILS,
  systemTemplateSchema,
  applySystemTemplate,
  defaultSystemTemplate,
} from "../system-catalog";
import { EMAIL_TEMPLATES, applyLibraryTemplate } from "../template-library";
import { stepSchema } from "../studio";

describe("emails existentes ligados ao editor", () => {
  it("inclui todos os nove emissores operacionais existentes", () => {
    expect(SYSTEM_EMAILS.map((x) => x.key)).toEqual(
      expect.arrayContaining([
        "paid",
        "cancelled",
        "proof",
        "account_code",
        "cash_close",
        "cash_day",
        "digest",
        "monthly",
        "alerts",
      ]),
    );
  });
  it("conserva o HTML e o assunto originais enquanto se usa o modelo actual", () => {
    const original = { subject: "Código de entrada", html: "<p>123456</p>" };
    expect(
      applySystemTemplate(defaultSystemTemplate("account_code"), original, {}),
    ).toEqual(original);
  });
  it("modelo alternativo mantém exactamente um bloco operacional com os valores do servidor", () => {
    const config = defaultSystemTemplate("cash_close");
    config.mode = "custom";
    config.step = applyLibraryTemplate(
      EMAIL_TEMPLATES[0].id,
      config.step,
      true,
    );
    const result = applySystemTemplate(
      config,
      { subject: "Fecho real", html: "<p>123 MT</p>" },
      { loja: "<script>x</script>" },
    );
    expect(result.html.match(/123 MT/g)).toHaveLength(1);
    expect(result.html).not.toContain("<script>");
  });
  it("não deixa tirar os dados do sistema nem atrasar códigos de acesso", () => {
    const config = defaultSystemTemplate("account_code");
    config.mode = "custom";
    expect(
      systemTemplateSchema.safeParse({
        ...config,
        step: { ...config.step, delay_minutes: 5 },
      }).success,
    ).toBe(false);
    expect(
      systemTemplateSchema.safeParse({
        ...config,
        step: {
          ...config.step,
          blocks: [{ type: "text", text: "Sem código" }],
        },
      }).success,
    ).toBe(false);
    expect(
      systemTemplateSchema.safeParse({ ...config, enabled: false }).success,
    ).toBe(false);
  });
  it("oferece pelo menos dez modelos válidos e independentes", () => {
    expect(EMAIL_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(EMAIL_TEMPLATES.map((t) => t.id)).size).toBe(
      EMAIL_TEMPLATES.length,
    );
    for (const t of EMAIL_TEMPLATES)
      expect(stepSchema.safeParse(t.step).success, t.id).toBe(true);
  });
});
